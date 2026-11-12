# AgentMemory Knowledge Graph Linker Reference (v4.0)

## 1. The `maxReads: 4096` KV Budget Architecture

In `@agentmemory/agentmemory` (`dist/index.mjs`, `queryGraphIndex`), every call to `POST /agentmemory/graph/query` with `{"limit": 500}` creates a bounded `GraphIndexReader`:

```js
const reader = await createGraphIndexReader(state, {
  maxReads: 4096, // Upgraded from 2048 to allow 1000+ edges
  maxBytes: 8 * 1024 * 1024
});
```

### Read Budget Breakdown

| Operation | KV Reads Consumed | Remaining Reads |
| :--- | :--- | :--- |
| Read index status & generation | `2` | `4094` |
| Read 500 node IDs from `"nodes"` LIFO posting list | `501` | `3593` |
| Fetch 500 node records via `reader.getNode(id)` | `500` | `3093` |
| Scan `"adjacency"` lists for `pageNodes[0..k]` | `1 + 2 * degree` per node | Bounded by `3093` |
| Final consistency check in `reader.finish()` | `2` | Complete if total `<= 4096` |

### Why `truncated: true` Still Happens
Even with `maxReads: 4096`, `GraphIndexReader` scans the **global** adjacency list (`1 + 2 * globalDeg` KV reads) for each node in the top-500 page. When high-visibility hubs inside `pageNodes` accumulate dozens of legacy heuristic `related_to` (`weight <= 0.45`) edges to older nodes outside the current 500-node slice, total reads exceed `4096`, triggering `truncated: true` and dropping tail adjacencies.

---

## 2. Read-Budget Simulator & Redundant Edge Compaction (`edge-compactor.mjs`)

`skill/agentmemory-graph-linker/scripts/edge-compactor.mjs` models the exact read budget and safely compacts redundant low-weight edges without side effects on import.

### Read-Cost Model (`estimateSubgraphReadCost`)
```text
estimatedReads = 2 + pageNodes.length + 1 + pageNodes.length + sum(1 + 2 * globalDeg)
```
`estimateSubgraphReadCost(pageNodes, allEdges, options)` returns:
- `{ estimatedReads, maxReads: 4096, wouldTruncate, headroomReads, pageNodeCount, totalGlobalDegree, adjacencyReads, hotHubs }`
- `hotHubs`: top read-heavy nodes in `pageNodes` with `{ id, name, type, globalDeg, estimatedReads, relatedToCount, lowWeightHeuristicCount, strongEdgeCount }`.

### Live Simulation (`runBudgetSimulation` / `--simulate-budget`)
- Queries `POST /agentmemory/graph/query` (`{ limit: queryLimit }`, default `500`), falling back to `mem:graph:nodes` LIFO sorting if the HTTP endpoint is unavailable.
- Compares live `truncated` status against `estimateSubgraphReadCost` and enumerates safe-to-compact candidate edges sorted by read savings, returning `estimatedReadsBefore` vs `estimatedReadsAfterCompaction` and `reason` per edge.

### Safe Edge Compaction (`compactRedundantEdges` / `--compact-edges`)
- **Dry-run by default**: `--compact-edges` runs with `dryRun: true` and mutates neither KV nor disk unless `--apply` is passed.
- **Target filter**: Only selects active edges where `type === "related_to"`, `Number(edge.weight ?? 0.4) <= 0.45` (`MAX_HEURISTIC_WEIGHT`), `!edge.stale && edge.isLatest !== false`, and at least one endpoint is in `pageNodes`.
- **Safety invariants**:
  1. **Degree floor (`MIN_SAFE_DEGREE = 2`)**: Removing an edge must NEVER drop either endpoint below `degree >= 2` (zero risk of creating unlinked degree-0 nodes).
  2. **Semantic strength or hub redundancy**: At least one endpoint must already have a stronger semantic edge (`fixes`, `depends_on`, `imports`, `modifies`, `uses` in `STRONG_SEMANTIC_EDGE_TYPES`, or `weight >= 0.8`) OR have `degree >= 6`.
  3. **Budget target & cap**: Stops as soon as `estimatedReads <= targetMaxReads` (default `3800`) or `limit` (default `250`) is reached.
- **5-Layer Execution (`--apply`)**:
  1. Appends each compacted edge (`reason: "edge_compacted_budget"`, `kind: "edge"`, `edge`, `sourceNode`, `targetNode`, `readSavings`, `compactionReason`) to `~/.agentmemory/graveyard.jsonl`.
  2. Calls `engine.applyRetrievalRecord(control, "edge", edge.id, null)` sequentially to unlink retrieval postings.
  3. Deletes records from `mem:graph:edges`, `mem:graph:edge-key`, and `mem:graph:edge-history`.
  4. Recomputes affected `mem:graph:node-degree` counts, updates `mem:graph:retrieval-control` (`"current"`), and triggers `mem::graph-snapshot-rebuild`.

---

## 3. Full 5-Layer KV Engine (`projectRecord` & `applyRetrievalRecord`)

In AgentMemory, every node and edge lives across **5 synchronized KV layers** inside the Rust `iii-engine` (scoped by active `generation` in `mem:graph:control`):

1. **Retrieval Index Data (`mem:graph:retrieval-data`)**:
   - Stores projections under `${buildId}:record:${kind}:${sha256(JSON.stringify(id))}` and maintains doubly-linked LIFO posting lists (`${buildId}:root:${posting}` and `${buildId}:entry:${posting}:${memberId}`) for `nodes`, `edges`, `name`, `character`, `observation`, `adjacency`, `edgeKey`, and `edgeObservation`.
   - Enforces **`MAX_POSTINGS = 192`** postings per record.
2. **Retrieval Index Control (`mem:graph:retrieval-control`, key `"current"`)**:
   - Tracks `nodes`, `edges` (counting active edges where `isLatest !== false`), `nodesByType` (validated against the 13 canonical `CONTROL_NODE_TYPES` plus `otherTypes`), `edgesByType`, `incompleteRecords`, and `revision`.
3. **Canonical Scopes (`mem:graph:nodes`, `mem:graph:edges`, `mem:graph:node-degree`, `mem:graph:membership`, `mem:graph:edge-history`)**.
4. **Lookup Indexes & Snapshot (`mem:graph:name-index`, `mem:graph:edge-key`, `mem:graph:snapshot`)**.
5. **Facets (`mem:facets`, #1642)**.

`createGraphKvEngine()` implements full parity with AgentMemory's internal `project()` and `planRecord()` functions:
- Passing `input = null` unlinks all postings and deletes the record.
- Passing `input = updatedNodeOrEdge` diffs `oldPostings` vs `newPostings`, unlinking removed tokens/adjacencies and linking new tokens/adjacencies at `root.head` without breaking inventory counts.

---

## 4. Semantic Deduplication, Bounded Alias Merging & Bi-Temporal Graph (`semantic-planner.mjs`)

`skill/agentmemory-graph-linker/scripts/semantic-planner.mjs` supplies the Neuro-Symbolic bridge for **Gemini 4 Hydrogen**:

### Structural Synonym Scoring (`--suggest-merges`)
- `scoreSynonymPair(nodeA, nodeB, neighborsById)` computes structural + lexical similarity using NFKC + Unicode dash normalization, normalized token Jaccard, containment/abbreviation match, shared neighbor Jaccard, and shared `sourceObservationIds` Jaccard (capping disjoint file basenames at `<= 0.35`).
- `findSemanticDuplicateCandidates(deps, { limit: 50, minScore: 0.45, includeCrossType: true })` skips exact duplicates and surfaces top synonym/alias pairs (`nodeA`, `nodeB`, `score`, `reasons`, `sharedNeighbors`, `sharedObs`, `suggestedWinner`, `suggestedAliases`) for LLM review.

### Bounded 5-Layer Alias Merging (`--merge-plan`)
`applySemanticMergePlan(deps, planItems, options)` executes `[{ keep, merge, canonicalName?, dryRun? }]`:
- Resolves IDs, exact/normalized/case-insensitive names, and chained prior-step merges.
- **Posting-budget bounds**:
  - `node.aliases` is merged and capped at **`MAX_NODE_ALIASES = 10`**.
  - `node.sourceObservationIds` is merged and capped at **`MAX_NODE_SOURCE_OBS = 24`** so `projectRecord()` always stays strictly below **`MAX_POSTINGS = 192`** when indexing name tokens, character trigrams, and observation postings.
- Archives each merged node (`reason: "semantic_merged"`, `mergedIntoId`, `mergedIntoName`, `node`, `incidentEdges`, `facets`) to `graveyard.jsonl`, deletes its `mem:facets`, repoints non-duplicate edges without self-loops or active-key collisions, updates all 5 KV layers, and rebuilds the snapshot.

### Contextual Link Batching & Bi-Temporal Edges (`--suggest-links` & `--apply-temporal`)
- `buildSemanticLinkBatch(deps, { limit: 40, maxObsPerNode: 3, maxExcerptChars: 240, hubLimit: 18 })` collects view `unlinked` and low-degree (`<= 1`) `related_to`-only nodes, pairs them with `mem:obs:*` observation excerpts (via `sourceObservationIds`) and top candidate domain hubs, and lists the 21 canonical `SEMANTIC_RELATIONS` (`uses`, `imports`, `modifies`, `causes`, `fixes`, `depends_on`, `related_to`, `implements`, `configures`, `replaces`, `caused_by`, `optimizes`, `optimizes_for`, `works_at`, `prefers`, `blocked_by`, `rejected`, `avoids`, `located_in`, `succeeded_by`, `supersedes`).
- `applyTemporalLinks(deps, triples, { dryRun })` validates triples (`{ source, target, type, weight?, tvalid?, tvalidEnd?, supersedes?, replaces?, reasoning?, sentiment?, confidence?, sourceObservationIds? }`):
  1. Creates/updates links through `applyDirectXmlLinks(secret, [], rels, { preserveRelationType: true })` so non-collapsed relation types are preserved.
  2. Persists bi-temporal metadata (`tvalid`, `tvalidEnd`, `version`, `isLatest: true`) directly across `mem:graph:edges`, `mem:graph:edge-key`, and `applyRetrievalRecord(..., "edge", ...)`.
  3. When `supersedes` / `replaces` matches an older edge (by edge ID or node/type target), marks the superseded edge `isLatest: false` with `tvalidEnd` and `supersededBy` across `mem:graph:edges`, `mem:graph:edge-history`, `mem:graph:edge-key` (removing stale lookup key), and `applyRetrievalRecord(..., "edge" | "history")`, while incrementing `version` on the active edge.

---

## 5. Sentry-Style Error Deduplication, Unicode Normalization & `parseAttrs` Self-Patch (`--dedup` & `--rename`)

### Why Phantom `&amp;quot;` & Unicode Hyphen `‑` Nodes Happened
1. In `@agentmemory/agentmemory` v0.9.32, `parseAttrs(raw)` extracted XML attributes without decoding XML entities (`&quot;`, `&lt;`, `&gt;`, `&apos;`, `&amp;`), creating recursive `&amp;quot;` node clones.
2. LLM outputs sometimes emit non-breaking hyphens `‑` (`\u2011`), figure dashes, or zero-width characters (`\u200b-\u200d\ufeff`), splitting identical entities into separate graph nodes.

### Fixes
1. `applySystemAndRamPatches()` patches `parseAttrs(raw)` in `dist/*.mjs` to iteratively decode XML entities, and `smart-router.mjs` sanitizes nested XML entities at the router boundary.
2. `normalizeSoftHyphens` and `normalizeUnicodeGraphKey` normalize NFKC + `[\u2010-\u2015\u2212\u00ad]` to ASCII `-` and strip zero-width characters.
3. `node graph-linker.mjs --dedup` groups XML-escaped clones, Unicode-dash variants (preferring ASCII `-` winners and queuing `singleNodeRenames` for isolated `\u2011` nodes), case-insensitive duplicates (`Flutter` vs `flutter`), and Sentry-style error fingerprints into a single Canonical Node, re-pointing edges across all 5 KV layers, incrementing `properties.occurrences`, and archiving merged duplicates into `~/.agentmemory/graveyard.jsonl`.
4. `node graph-linker.mjs --rename "<old>" "<new>" [--type <type>]` renames any node in-place across all 5 KV layers (or atomically merges if the target name exists).

---

## 6. Zero-Token Audit, Cold Graveyard, Immunity Whitelist & Verification Gate (`--audit`, `--prune`, `--restore`, `--verify-json`)

### Zero-Token Provenance Verification (`--audit`)
`performGraphAudit()` loads `mem:obs:*`, `mem:memories`, and `mem:summaries` in `<400ms` over WebSocket and flags:
1. **Off-Domain Hallucinations** (`HALLUCINATION_REGEX`) and unmapped CJK characters (`CJK_REGEX` outside `CJK_CANONICAL_MAP`).
2. **Zero Corpus Overlap**: Low-degree non-immune nodes with zero token overlap across recorded observations/memories/summaries and zero match in `TECH_LEXICON`.
3. **Duplicate Groups, XML Corruption, Unicode-Dash Renames & Transient Scratch**.

### Immunity Whitelist & Cold Graveyard (`~/.agentmemory/graveyard.jsonl`)
- **Immune Nodes**: `decision`, `preference`, `pattern`, `person`, `project`, `milestone`, `song`, any `error` node with a `fixes` edge, thematic domain anchors, and any hub with `degree >= 4` are immune from `--prune`.
- **Cold Graveyard**: Before `--prune`, `--dedup`, `--delete`, `--merge-plan`, or `--compact-edges --apply` removes any node or edge from KV, it writes `{ archivedAt, reason, ... }` to `~/.agentmemory/graveyard.jsonl`.
- **Lossless Recovery (`--restore`)**: `node graph-linker.mjs --restore "<name_or_id|--last|--list>"` restores archived nodes, incident edges, and facets back into all 5 KV layers.

### Verification Gate (`--verify-json [--strict]`)
`runVerifyJson` & `evaluateVerifyInvariants` run a non-destructive read-only sweep combining `POST /agentmemory/graph/query` (`limit: 500`), `GET /agentmemory/graph/index`, `GET /agentmemory/graph/stats`, `performGraphAudit`, and `maintenance.lock` status:
- Returns `{ status: "verified" | "failed", version: "4.0", strict, invariants: { unlinkedCount, globalDeg0Count, incompleteRecords, auditReducible, truncated, maintenanceLockActive, coverage, indexState, indexReady, viewNodes, viewEdges, totalStoreNodes, totalStoreEdges, ... }, checks: { viewLinked, globalConnected, indexComplete, auditClean, untruncated, strictBudgetOk, indexReady, maintenanceUnlocked } }`.
- Exits `0` iff `unlinkedCount === 0 && globalDeg0Count === 0 && incompleteRecords === 0 && auditReducible === 0 && (!strict || !truncated)`; otherwise exits `1`.
- Note on `@agentmemory/agentmemory` pagination vs. read budget: `POST /agentmemory/graph/query { limit: 500 }` returns `truncated: true` whenever **either** `reader.exhausted` hits `maxReads: 4096` (dropping tail edges) **or** `totalStoreNodes > 500` (non-null pagination `cursor`). Use `--simulate-budget` (target `wouldTruncate: false`) and scoped queries (`startNodeId`, `limit: 500`) to confirm read-budget health on stores with `> 500` nodes, and reserve `--verify-json --strict` for untruncated slices (`totalStoreNodes <= 500`).

---

## 7. Real `iii-engine` RAM & Extraction Optimization (`--optimize-ram` & `--heal`)

Why AgentMemory grows in RAM and dead letters on busy sessions:
- Thousands of uncompacted nodes/edges expand into `120,000+` doubly-linked posting records in `mem:graph:retrieval-data`.
- Capping `MAX_OBS_PER_SESSION` at `800` caused long sessions to drop observations into dead letters, while `event::session::stopped` re-ran graph extraction over the entire session observation list on every turn.

`node graph-linker.mjs --optimize-ram` (and `applySystemAndRamPatches`):
1. Tunes `~/.agentmemory/.env` with **`MAX_OBS_PER_SESSION=0`** (unlimited observations per session, preventing dead-letter drops) and `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500`.
2. Patches `dist/*.mjs` with:
   - `maxReads: 4096` (`8MB`) and `parseAttrs` XML decoding.
   - **`event::session::stopped` watermark (`graph_wm:<sessionId>` in `KV.config`)**: Tracks `newestIso` (with a 10-minute default floor) and skips `maintenance.lock`, so only newly compressed non-`DIRECT_GRAPH_XML` observations are queued for extraction.
   - **`extractGraphHeuristics` & `mem::graph-extract` noise/orphan guard**: Normalizes NFKC + Unicode hyphens, drops scratch paths & unmapped CJK before node construction, honors `maintenance.lock` (bypassed only by `DIRECT_GRAPH_XML`), and filters out degree-0 orphan nodes unless `isDirectXml || allowIsolated === true`.
3. Runs `--dedup` and `--prune` to evict duplicate/scratch records from `mem:graph:retrieval-data`, then triggers `mem::session-sweep` and `mem::graph-snapshot-rebuild`.

---

## 8. Task-Aware Smart AI Router Architecture (`smart-router.mjs` v4.0)

`router/smart-router.mjs` runs at `:3118` (loaded from `~/.agentmemory/.env`) with **Task-Aware Model Tiering** via `selectTargetsForFormat(expectedFormat, targets)`:

| Task Format | Tier Order | Primary Goal |
| :--- | :--- | :--- |
| **`observation` / `any`** (`FAST_MODEL_ORDER`) | `gemini-3.1-flash-lite-preview` -> `gemini-flash-lite-latest` -> `openai/gpt-oss-20b` -> `gemma-4-26b-a4b-it` -> `qwen/qwen3.8-27b` -> `gemini-flash-latest` -> `gemini-3.8-flash` -> `openai/gpt-oss-120b` -> Z Fold 3 USB/Wi-Fi (`qwen2.5-3b-instruct`) -> Local Extractive Fallback | Low latency, high quota for frequent per-tool `<observation>` calls |
| **`summary` / `entities` / `graph` / `temporal_graph`** (`ACCURACY_MODEL_ORDER`) | `gemini-3.8-flash` -> `gemini-flash-latest` -> `openai/gpt-oss-120b` -> `gemma-4-26b-a4b-it` -> `gemini-3.1-flash-lite-preview` -> `gemini-flash-lite-latest` -> `openai/gpt-oss-20b` -> `qwen/qwen3.8-27b` -> Z Fold 3 USB/Wi-Fi (`qwen2.5-3b-instruct`) -> Local Extractive Fallback | Higher reasoning accuracy for `<summary>` & graph extraction |

Additional v4.0 router hardening:
- **`<observation>` & `<summary>` XML sanitization (`sanitizeObservationOrSummaryXml`)**: Cleans `<file>` and `<concept>` entries via `isNoisyScratchEntityName`, `CJK_CANONICAL_MAP`, and `normalizeUnicodeDashes`.
- **Clean Local Extractive Fallback (`buildLocalExtractiveFallback`)**: Both `<summary>` and `<observation>` branches extract real file paths and concepts from `userMsg`, skip `/tmp/` and scratch files, and never inject hardcoded fake `~/.agentmemory/.env` or `agent-workflow` edges.
- **`sanitizeGraphXmlOutput`**: Supports both self-closing (`<entity .../>`) and body-element (`<entity ...>...</entity>`, `<relationship ...>...</relationship>`) XML tags.
- **`GET /` status JSON**: Reports `version: "4.0"`, `features`, `chains: { fast, accuracy }`, and `chain`.
- **Entrypoint guard**: `server.listen(...)` runs only when executed directly (`process.argv[1]`), allowing unit tests to import exported pure helpers without binding port `:3118`.

---

## 9. Changelog

### v4.0 (2026-11-13) — Gemini 4 Hydrogen Hybrid Neuro-Symbolic Upgrade
- **Read-Budget Simulator & Safe Edge Compaction (`edge-compactor.mjs`)**: Added `--simulate-budget` and `--compact-edges [--apply]` to keep `POST /agentmemory/graph/query` under `maxReads: 4096` without ever dropping endpoints below `minDegree >= 2`.
- **Semantic Planner & Bi-Temporal Graph (`semantic-planner.mjs`)**: Added `--suggest-merges`, `--merge-plan` (bounded `aliases <= 10`, `sourceObservationIds <= 24` under `MAX_POSTINGS=192`), `--suggest-links` (with `mem:obs:*` excerpts + hubs), and `--apply-temporal` (`tvalid`, `tvalidEnd`, `supersedes`/`replaces`, `isLatest: false`, `supersededBy`, and `preserveRelationType: true`).
- **Mandatory Verification Gate (`--verify-json [--strict]`)**: Added deterministic JSON invariant check + exit codes (`0` verified / `1` failed).
- **Task-Aware Smart AI Router v4.0 (`smart-router.mjs`)**: Added `FAST_MODEL_ORDER` vs `ACCURACY_MODEL_ORDER` (`selectTargetsForFormat`), added `gemini-flash-latest`, fixed `<observation>` `buildLocalExtractiveFallback` hygiene (removed fake `.env` fallback edges), expanded `sanitizeGraphXmlOutput` for body XML tags, and exported pure helpers behind an entrypoint guard.
- **Modular Entrypoint Guards & Automated `node:test` Suite**: Guarded `main()` in `graph-linker.mjs`, exported core helpers, updated `install.sh` v4.0 (`chmod +x` across all `scripts/*.mjs`), and added zero-side-effect `tests/*.test.mjs`.

### v3.2 (2026-11-09) — Session Stability, Heuristic Hygiene & Audio Constellation
- **Unlimited Session Observations (`MAX_OBS_PER_SESSION=0`)**: Replaced the `800` cap with `0` (unlimited) in `--optimize-ram` / `--heal` to prevent dead-letter rejections in long sessions.
- **Music & Audio Constellation Preservation**: Added `song` to `IMMUNE_NODE_TYPES` and linked Hi-Res audio/music entities into `macOS Hardware & Hi-Res Audio`.
- **`event::session::stopped` Watermark & `extractGraphHeuristics` Guards**: Added `graph_wm:<sessionId>` incremental watermarking, heuristic/LLM scratch+CJK+orphan filtering, Unicode hyphen `‑` normalization (`normalizeSoftHyphens` / `normalizeUnicodeGraphKey`), `sanitizeObservationOrSummaryXml`, and swapped dead `gemini-2.5-flash` for `gemini-3.1-flash-lite-preview`.

### v3.1 (2026-11-08)
- **Maintenance Lock Mode (`--lock` & `--unlock`)**, **CJK Foreign Language & Hallucination Gate**, and **Audit CJK Candidate Reporting**.

### v3.0 (2026-11-07)
- **Zero-Token Provenance & Hallucination Audit (`--audit`)**, **Sentry-Style Error Fingerprinting & 5-Layer Atomic Deduplication (`--dedup`)**, **5-Layer Atomic Rename (`--rename`)**, **Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) & `--restore`**, and **Real `iii-engine` RAM Optimization (`--optimize-ram`) & `parseAttrs` XML Self-Patch**.

### v2.2 (2026-11-05)
- **Zero-Token Incremental Log Inspector (`--logs` & `--heal`, #1662 / #1674)**, **Smart AI Router v2.2 Truncated Reply Failover (#1495) & Surrogate-Safe Slicing (#1598)**, and **5-Layer `--delete` with Facet Cleanup (#1642)**.
