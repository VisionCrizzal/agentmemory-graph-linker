---
name: agentmemory-graph-linker
description: Hybrid neuro-symbolic companion skill for AgentMemory (v4.0, Gemini 4 Hydrogen). Runs zero-token graph audits (--audit), read-budget simulation (--simulate-budget), safe redundant edge compaction (--compact-edges), structural synonym/link batching (--suggest-merges / --suggest-links), 5-layer atomic alias merges (--merge-plan), bi-temporal relation linking (--apply-temporal), Cold Graveyard archival/restore (--prune / --restore), maintenance locking (--lock / --unlock), RAM/log healing (--optimize-ram / --heal / --logs), zero-token linking fallback (--beautify / --auto), and mandatory verification (--verify-json [--strict]).
user-invocable: true
---

# AgentMemory Knowledge Graph Linker, Semantic Planner, Edge Compactor & RAM Optimizer (v4.0)

> **Companion Skill for [AgentMemory (`rohitg00/agentmemory`)](https://github.com/rohitg00/agentmemory)**  
> Requires [`@agentmemory/agentmemory`](https://github.com/rohitg00/agentmemory) daemon and `iii` engine running locally. Distributed under the [MIT License](./LICENSE).

Hybrid Neuro-Symbolic skill upgraded for **Gemini 4 Hydrogen**: pairs deterministic, zero-token symbolic inspection and 5-layer KV execution (`graph-linker.mjs`, `edge-compactor.mjs`, `semantic-planner.mjs`) with structured candidate batches for Hydrogen semantic reasoning, backed by the Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) and a mandatory `--verify-json [--strict]` verification gate on the [AgentMemory](https://github.com/rohitg00/agentmemory) Knowledge Graph (`http://localhost:3113/#graph`).

## Gemini 4 Hydrogen Workflow (Hybrid Neuro-Symbolic / Verification-First)

Follow this 4-phase loop instead of rigid blind heuristics:

### Phase 1 — Observe & Extract Candidates (0 LLM tokens)
1. **Baseline health & invariants**: Run `--status` and `--verify-json` to inspect `unlinkedCount`, `globalDeg0Count`, `incompleteRecords`, `auditReducible`, and `truncated`.
2. **Read-budget pressure check**: Run `--simulate-budget` to see whether top-500 queries exceed `maxReads: 4096` (`wouldTruncate` / `truncated`), inspect `hotHubs`, and list safe low-weight `related_to` compaction candidates.
3. **Structural & provenance audits**:
   - `--audit [--days 14]` detects XML-entity clones, Sentry-style error groups, Unicode hyphen `‑` (`\u2010-\u2015\u2212\u00ad`) variants, unmapped CJK/off-domain hallucinations, transient scratch paths, and stale isolated nodes.
   - `--suggest-merges [--limit N] [--min-score S] [--same-type-only]` extracts fuzzy synonym/alias pairs (`score`, `reasons`, `sharedNeighbors`, `sharedObs`, `suggestedWinner`, `suggestedAliases`).
   - `--suggest-links [--limit N]` gathers view `unlinked` and low-degree (`<= 1`) `related_to`-only nodes alongside `mem:obs:*` observation excerpts and candidate domain hubs.
4. **Optional Maintenance Lock**: Run `--lock "<reason>"` before multi-step manual edits (`--beautify` and `--optimize-ram` auto-lock automatically).

### Phase 2 — Hydrogen Semantic Review (Reasoning Layer)
- Review `--audit`, `--suggest-merges`, and `--suggest-links` JSON outputs directly:
  - Approve true synonym pairs into a merge plan JSON (`[{ "keep": "<id_or_name>", "merge": "<id_or_name>", "canonicalName": "..." }]`) and skip false positives (e.g., distinct files or versions).
  - Synthesize typed semantic and bi-temporal triples (`[{ "source": "...", "target": "...", "type": "implements|configures|replaces|caused_by|optimizes|fixes|depends_on|supersedes|...", "weight": 0.9, "tvalid": "2026-11-13T00:00:00Z", "supersedes": "<old_edge_or_target>" }]`) grounded in the returned observation excerpts rather than generic `related_to` edges.

### Phase 3 — Safe Symbolic Execution (5-Layer Atomic + Cold Graveyard)
1. **Exact & structural cleanup**: Run `--dedup` (merges XML-entity clones, Unicode-hyphen duplicates, case duplicates, and Sentry error fingerprints; renames isolated `\u2011` nodes) and `--prune` (archives scratch/hallucinations to `~/.agentmemory/graveyard.jsonl`, honoring the Immunity Whitelist).
2. **Semantic alias merges**: Run `--merge-plan '<json_or_file>' [--dry-run]`. Bounds `node.aliases <= 10` and `sourceObservationIds <= 24` (strictly under `MAX_POSTINGS=192`), archives merged nodes/edges/facets to `graveyard.jsonl` (`reason: "semantic_merged"`), repoints non-duplicate edges without self-loops, and rebuilds the snapshot.
3. **Bi-temporal & typed links**: Run `--apply-temporal '<json_or_file>' [--dry-run]`. Routes through `DIRECT_GRAPH_XML` with `preserveRelationType: true` and persists `tvalid`, `tvalidEnd`, `version`, `isLatest`, and `supersededBy` across `mem:graph:edges`, `mem:graph:edge-history`, `mem:graph:edge-key`, and the retrieval index.
4. **Read-budget compaction (if `truncated` or near 4096 reads)**: Preview with `--compact-edges` (dry-run by default), then execute with `--compact-edges --apply [--target-reads 3800] [--limit 250]`. Only removes low-weight heuristic `related_to` (`weight <= 0.45`) edges on hubs while enforcing `minDegree >= 2` so zero nodes become unlinked.
5. **Release manual lock**: Run `--unlock` if you called `--lock` manually.

### Phase 4 — Mandatory Verification Gate
Always finish graph changes with `--verify-json` (or `--verify-json --strict` when enforcing untruncated top-500 queries):
```bash
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --verify-json --strict
```
- **Exit `0` (`status: "verified"`)** iff `unlinkedCount === 0 && globalDeg0Count === 0 && incompleteRecords === 0 && auditReducible === 0 && (!strict || !truncated)`.
- **Exit `1` (`status: "failed"`)** if any invariant or strict budget check fails—inspect `invariants` and `checks` before declaring completion.

### Zero-Token Fallback Compatibility (`--auto` / `--beautify`)
When operating purely deterministically with 0 LLM tokens, `--beautify` (6 balanced thematic constellations + auto-lock + multi-pass sweep) and `--auto` (fast anchor linking) remain fully supported alongside `--dump` / `--apply`.

## Quick start (CLI reference)

```bash
SCRIPT=~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs

# 1. Inspect view status, unlinked count, lock state & verification gate
node "$SCRIPT" --status
node "$SCRIPT" --verify-json [--strict] [--days 14]

# 2. Maintenance Lock (freezes background LLM extraction in Smart Router at 0ms, 0 tokens)
node "$SCRIPT" --lock "Manual refactoring"
node "$SCRIPT" --unlock

# 3. Zero-token candidate extraction & read-budget simulation
node "$SCRIPT" --audit [--days 14]
node "$SCRIPT" --simulate-budget [--limit N] [--target-reads N] [--query-limit N]
node "$SCRIPT" --suggest-merges [--limit N] [--min-score S] [--same-type-only]
node "$SCRIPT" --suggest-links [--limit N]

# 4. Safe symbolic execution (5-layer KV + Cold Graveyard)
node "$SCRIPT" --dedup
node "$SCRIPT" --merge-plan '<json_or_file>' [--dry-run]
node "$SCRIPT" --prune [--days 14] [--include-stale] [--include-hallucinations] [--no-hallucinations]
node "$SCRIPT" --apply-temporal '<json_or_file>' [--dry-run]
node "$SCRIPT" --compact-edges [--apply] [--target-reads N] [--limit N] [--query-limit N]

# 5. In-place rename, lossless Cold Graveyard restore & explicit delete
node "$SCRIPT" --rename "Old Node Name or gn_id" "Clean New Name" [--type <new_type>]
node "$SCRIPT" --restore --list
node "$SCRIPT" --restore --last
node "$SCRIPT" --restore "Node Name or gn_id"
node "$SCRIPT" --delete "Node Name 1" "gn_node_id_2"

# 6. Zero-token linking fallbacks, RAM optimization & log/health recovery
node "$SCRIPT" --beautify
node "$SCRIPT" --auto
node "$SCRIPT" --dump
node "$SCRIPT" --apply /path/to/links.json
node "$SCRIPT" --optimize-ram
node "$SCRIPT" --heal          # alias: --drain
node "$SCRIPT" --logs [--reset-cursor]
node "$SCRIPT" --help          # or -h
```

## Architecture & Hardening Highlights (v4.0)

1. **Read-Budget Simulator & Safe Edge Compaction (`edge-compactor.mjs`)**:
   - Models the exact `GraphIndexReader` `maxReads: 4096` (`8MB`) read cost across 500 `pageNodes`. Safely compacts redundant `related_to` (`weight <= 0.45`) hub edges while enforcing `minDegree >= 2` and preserving strong semantic edges (`fixes`, `depends_on`, `imports`, `modifies`, `uses`, `weight >= 0.8`).
2. **Semantic Synonym Planning & Bi-Temporal Edges (`semantic-planner.mjs`)**:
   - Combines 0-token structural/lexical similarity (`scoreSynonymPair`) with bounded 5-layer alias merging (`aliases <= 10`, `sourceObservationIds <= 24` under `MAX_POSTINGS=192`) and bi-temporal versioning (`tvalid`, `tvalidEnd`, `supersedes`/`replaces`, `isLatest: false`, `supersededBy`).
3. **Unlimited Session Observations & Watermarked Extraction (`MAX_OBS_PER_SESSION=0`)**:
   - `--optimize-ram` and `--heal` tune `~/.agentmemory/.env` with `MAX_OBS_PER_SESSION=0` (disabling the per-session cap so long coding sessions never hit dead-letter rejections) alongside `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500`.
   - `applySystemAndRamPatches()` patches `event::session::stopped` with a per-session watermark (`graph_wm:<sessionId>` in `KV.config`, 10-minute default lookback floor) so AgentMemory only extracts observations newer than the watermark and skips when `maintenance.lock` is active.
4. **Heuristic, Router & Unicode Hyphen `‑` Hygiene**:
   - **`extractGraphHeuristics` & `mem::graph-extract` noise/orphan guard**: Normalizes NFKC + Unicode hyphens, drops scratch paths (`.system_generated/`, `.user_uploaded/`, `/tmp/`, `obs_*`, `cap_*`, etc.) and unmapped CJK before node creation, and strips degree-0 orphan nodes unless `DIRECT_GRAPH_XML` or `allowIsolated === true`.
   - **Smart Router v4.0 (`smart-router.mjs`)**: Adds Task-Aware Model Tiering (`FAST_MODEL_ORDER` for `<observation>` vs `ACCURACY_MODEL_ORDER` for `<summary>`/`<entities>`/`graph`), `<observation>`/`<summary>` XML sanitization (`sanitizeObservationOrSummaryXml`), body-tag `<entity>`/`<relationship>` sanitization, and clean `buildLocalExtractiveFallback` extraction (never attaches fake hardcoded `~/.agentmemory/.env` or `agent-workflow` edges).
   - **Unicode hyphen `‑` normalization**: `normalizeSoftHyphens` / `normalizeUnicodeGraphKey` fold `\u2010-\u2015\u2212\u00ad` (such as non-breaking hyphen `‑`) and zero-width characters to ASCII `-`, letting `--dedup` merge dash-variant duplicates and rename isolated `‑` nodes cleanly.
5. **Maintenance Lock, Cold Graveyard & 0-Token Log Cursor**:
   - `--lock` / `--unlock` freezes background LLM graph extraction via `~/.agentmemory/maintenance.lock` (`<entities></entities><relationships></relationships>` in `0ms`, `0` tokens).
   - Immunity Whitelist protects `decision`, `preference`, `pattern`, `person`, `project`, `milestone`, `song`, `fixes`-linked `error` nodes, thematic anchors, and `degree >= 4` hubs; all evicted/merged/compacted items are backed up to `~/.agentmemory/graveyard.jsonl` for lossless `--restore`.
   - `--logs` / `--heal` tracks `{ ino, offset, mtimeMs }` in `~/.agentmemory/.log-heal-cursor.json` for 0-token incremental crash/daemon log inspection.

## See also

- [REFERENCE.md](REFERENCE.md) for the `4096` read-budget simulator & compactor math, 5-layer KV engine (`MAX_POSTINGS=192`), semantic dedup & bi-temporal schema, Task-Aware Smart Router tiers, and v3.2/v4.0 changelog.
- [scripts/graph-linker.mjs](scripts/graph-linker.mjs) for the CLI entrypoint and verification gate (`--verify-json`).
- [scripts/edge-compactor.mjs](scripts/edge-compactor.mjs) for read-budget simulation and redundant edge compaction.
- [scripts/semantic-planner.mjs](scripts/semantic-planner.mjs) for synonym candidate scoring, alias merging, link batching, and bi-temporal application.
