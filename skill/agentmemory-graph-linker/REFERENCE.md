# AgentMemory Knowledge Graph Linker Reference (v3.0)

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
| Scan `"adjacency"` lists for `pageNodes[0..k]` | `1 + 2 * degree` per node | Reads `1,000+` edges smoothly |
| Final consistency check in `reader.finish()` | `2` | Consistently completes |

---

## 2. Full 5-Layer KV Engine (`projectRecord` & `applyRetrievalRecord`)

In AgentMemory, every node and edge lives across **5 synchronized KV layers** inside the Rust `iii-engine` (scoped by active `generation` in `mem:graph:control`):

1. **Retrieval Index Data (`mem:graph:retrieval-data`)**:
   - Stores projections under `${buildId}:record:${kind}:${sha256(JSON.stringify(id))}` and maintains doubly-linked LIFO posting lists (`${buildId}:root:${posting}` and `${buildId}:entry:${posting}:${memberId}`) for `nodes`, `edges`, `name`, `character`, `observation`, `adjacency`, `edgeKey`, and `edgeObservation`.
2. **Retrieval Index Control (`mem:graph:retrieval-control`, key `"current"`)**:
   - Tracks `nodes`, `edges`, `nodesByType` (strictly validated against the 13 canonical `CONTROL_NODE_TYPES` plus `otherTypes`), `edgesByType`, `incompleteRecords`, and `revision`.
3. **Canonical Scopes (`mem:graph:nodes`, `mem:graph:edges`, `mem:graph:node-degree`, `mem:graph:membership`, `mem:graph:edge-history`)**.
4. **Lookup Indexes & Snapshot (`mem:graph:name-index`, `mem:graph:edge-key`, `mem:graph:snapshot`)**.
5. **Facets (`mem:facets`, #1642)**.

In v3.0, `createGraphKvEngine()` implements full parity with AgentMemory's internal `project()` and `planRecord()` functions:
- Passing `input = null` unlinks all postings and deletes the record.
- Passing `input = updatedNodeOrEdge` diffs `oldPostings` vs `newPostings`, unlinking removed tokens/adjacencies and linking new tokens/adjacencies at `root.head` without breaking inventory counts.

---

## 3. Sentry-Style Error Deduplication, Atomic Rename & `parseAttrs` Self-Patch (`--dedup` & `--rename`)

### Why Phantom `&amp;quot;` Nodes Happened & How v3.0 Eliminates Them
In `@agentmemory/agentmemory` v0.9.32, `parseAttrs(raw)` in `dist/index.mjs` and `dist/compression-recovery-*.mjs` extracted XML attributes via `/([A-Za-z_][\w:-]*)="([^"]*)"/g` without decoding XML entities (`&quot;`, `&lt;`, `&gt;`, `&apos;`, `&amp;`). Whenever an LLM or `DIRECT_GRAPH_XML` escaped `<`, `>`, or `"` inside `name="..."`, AgentMemory stored the literal entity string as a new node name, which then got re-escaped on subsequent runs (`&amp;quot;`, `&amp;amp;quot;`).

**v3.0 Fix**:
1. `applySystemAndRamPatches()` automatically patches `parseAttrs(raw)` in `dist/*.mjs` to iteratively decode XML entities, and `smart-router.mjs` v3.0 sanitizes nested XML entities at the router boundary.
2. `node graph-linker.mjs --dedup` groups all existing XML-escaped clones, case-insensitive duplicates (`Flutter` vs `flutter`), and Sentry-style error fingerprints (e.g., all `xcodebuild` / `exit code 72` error variants) into a single Canonical Node, re-points all incident edges across all 5 KV layers, increments `properties.occurrences`, and archives merged duplicates into `~/.agentmemory/graveyard.jsonl`.
3. `node graph-linker.mjs --rename "<old>" "<new>" [--type <type>]` renames any node in-place across all 5 KV layers (or atomically merges it if the target name already exists).

---

## 4. Zero-Token Hallucination Audit, Cold Graveyard & Immunity Whitelist (`--audit`, `--prune`, `--restore`)

### Zero-Token Provenance Verification
`performGraphAudit()` loads the local text corpus across `mem:obs:*`, `mem:memories`, and `mem:summaries` in `<350ms` over WebSocket and checks every low-degree non-immune node against:
1. **Off-Domain Hallucination Blocklist** (`HALLUCINATION_REGEX`: e.g. `"invasion German"`, `"World War"`, etc.).
2. **Corpus Token Overlap + Tech Lexicon**: Flags nodes that have **zero token overlap** with all recorded observations/memories/summaries and **zero match** in `TECH_LEXICON` (catching LLM spelling/entity hallucinations like `"Craig"`, `"Fightnite"`, `"Quyên"`, `"Quyén"` at 0 LLM token cost).

### Immunity Whitelist ("Kim Bài Miễn Tử") & Cold Graveyard (`~/.agentmemory/graveyard.jsonl`)
- **Immune Nodes**: `decision`, `preference`, `pattern`, `person`, `project`, `milestone`, any `error` node with a `fixes` edge, thematic domain anchors, and any hub with `degree >= 4` are strictly immune from `--prune`.
- **Cold Graveyard**: Before `--prune`, `--dedup`, or `--delete` removes any node from the 5 KV layers, it appends `{ archivedAt, reason, node, incidentEdges, facets }` to `~/.agentmemory/graveyard.jsonl`.
- **Lossless Recovery (`--restore`)**: `node graph-linker.mjs --restore "<name_or_id|--last>"` reads the entry from `graveyard.jsonl` and re-projects the node, its incident edges, and its facets back into all 5 KV layers.

---

## 5. Real `iii-engine` RAM Optimization (`--optimize-ram`)

Why AgentMemory can consume ~1 GB RAM on Intel Macs:
- The Rust `iii-engine` holds active KV scopes in memory. 4,000+ nodes and 11,000+ edges expand into ~120,000+ individual doubly-linked posting records in `mem:graph:retrieval-data`.
- High `MAX_OBS_PER_SESSION=5000` and `AGENTMEMORY_CAPTURE_OUTPUT_MAX=8000` keep tens of megabytes of raw tool output strings in memory per session.

`node graph-linker.mjs --optimize-ram` (and `--heal`):
1. Tunes `~/.agentmemory/.env` (`MAX_OBS_PER_SESSION=800`, `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500`).
2. Runs `--dedup` and `--prune` to evict duplicate nodes, transient `.system_generated/` / `.user_uploaded/` / `/tmp/` scratch nodes, and their thousands of posting list records from `mem:graph:retrieval-data`.
3. Triggers `mem::session-sweep` and `mem::graph-snapshot-rebuild`.

---

## 6. Changelog

### v3.0 (2026-11-07)
- **Zero-Token Provenance & Hallucination Audit (`--audit`)**: Cross-checks nodes against the full `mem:obs:*` + `mem:memories` + `mem:summaries` corpus and `TECH_LEXICON` in `<400ms` with 0 LLM tokens.
- **Sentry-Style Error Fingerprinting & 5-Layer Atomic Deduplication (`--dedup`)**: Collapses duplicate error nodes, case-insensitive duplicates, and XML-entity phantom clones into canonical nodes while re-pointing edges and tracking `properties.occurrences`.
- **5-Layer Atomic In-Place Rename (`--rename`)**: Updates or merges nodes across `mem:graph:nodes`, `mem:graph:name-index`, `mem:graph:node-degree`, `mem:graph:retrieval-data`, and `mem:graph:retrieval-control`.
- **Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) & Lossless `--restore` (`--prune` & `--restore`)**: Protects core knowledge with an Immunity Whitelist while archiving pruned/deleted nodes and edges to disk for 1-command restoration.
- **Real `iii-engine` RAM Optimization (`--optimize-ram`) & `parseAttrs` XML Entity Self-Patch**: Tunes `MAX_OBS_PER_SESSION=800` & `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500`, patches `parseAttrs(raw)` in `dist/*.mjs` to decode XML entities natively, and upgrades `smart-router.mjs` to v3.0 with an `<entities>` noise/hallucination gate.

### v2.2 (2026-11-05)
- **Zero-Token Incremental Log Inspector (`--logs` & `--heal`, #1662 / #1674)**, **Smart AI Router v2.2 Truncated Reply Failover (#1495) & Surrogate-Safe Slicing (#1598)**, and **5-Layer `--delete` with Facet Cleanup (#1642)**.
