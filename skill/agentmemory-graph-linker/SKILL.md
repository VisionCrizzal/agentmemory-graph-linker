---
name: agentmemory-graph-linker
description: Hybrid neuro-symbolic companion skill for AgentMemory (v4.1, Gemini 4 Hydrogen). Runs zero-token graph audits (--audit), read-budget simulation (--simulate-budget), safe redundant edge compaction (--compact-edges), compact clustered synonym/link batching (--suggest-merges / --suggest-links --pair-mode), zero-risk auto-safe merging (--auto-safe), one-shot apply-and-compact cycles (--apply-and-compact / --cycle), 5-layer atomic alias merges (--merge-plan), bi-temporal relation linking (--apply-temporal), Cold Graveyard archival/restore (--prune / --restore), maintenance locking (--lock / --unlock), RAM/log healing (--optimize-ram / --heal / --logs), zero-token linking fallback (--beautify / --auto), clean JSON stdout (--quiet / --json / --minify), and mandatory verification (--verify-json [--strict]).
user-invocable: true
---

# AgentMemory Knowledge Graph Linker, Semantic Planner, Edge Compactor & RAM Optimizer (v4.1)

> **Companion Skill for [AgentMemory (`rohitg00/agentmemory`)](https://github.com/rohitg00/agentmemory)**  
> Requires [`@agentmemory/agentmemory`](https://github.com/rohitg00/agentmemory) daemon and `iii` engine running locally. Distributed under the [MIT License](./LICENSE).

Hybrid Neuro-Symbolic skill upgraded for **v4.1 Token-Efficient Consolidation**: pairs deterministic, zero-token symbolic inspection, auto-safe morphological/compact merging, connected-component duplicate clustering, compact deduplicated `hubCatalog` payloads, `hubLeafGroups` read-budget pair discovery, and single-pass `--apply-and-compact` execution (`graph-linker.mjs`, `edge-compactor.mjs`, `semantic-planner.mjs`), backed by the Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) and `--verify-json [--strict]` on [AgentMemory](https://github.com/rohitg00/agentmemory).

## Gemini 4 Hydrogen Workflow (Token-Efficient v4.1 Loop)

### Phase 1 — Observe & Extract Compact Candidates (0 LLM tokens)
1. **Baseline health & invariants**: Run `--status` and `--verify-json` (clean JSON stdout with OTel disabled by default; add `--minify` for single-line output).
2. **Read-budget pressure check**: Run `--simulate-budget` to inspect `estimatedReads` vs `maxReads: 4096`, `headroomReads`, `hotHubs`, and candidate compactions.
3. **Auto-safe pre-clean & compact synonym clusters**:
   - `--dedup --auto-safe` (or `--merge-plan --auto-safe`): executes deterministic structural dedup PLUS zero-risk semantic merges (`compact_match_safe`, `plural_singular_safe`, `corroborated_high_sim` with numeric version guards) at 0 LLM tokens.
   - `--suggest-merges [--limit N] [--min-score 0.60] [--clusters-only] [--full]`: defaults to **compact** output (`compact: true`) and groups connected duplicate pairs into `clusters` + `autoSafePlan` + `reviewClusterCount` so N-node synonyms resolve in one round.
4. **Budget-aware link & pair discovery**:
   - `--suggest-links [--limit N] [--pair-mode] [--full]`: deduplicates hubs into a single root `hubCatalog` (referencing `candidateHubIds` per item), distinguishes `trulyIsolatedCount` (`globalDegree === 0`) from `viewOnlyUnlinkedCount`, includes `budget` telemetry, and surfaces **`hubLeafGroups`** (pairs of `globalDeg === 2` leaves attached via `w <= 0.45` `related_to` edges to hot hubs — linking two such leaves lets `--compact-edges` delete both weak hub edges for `-4` net KV reads!).
   - Pass `--pair-mode` when headroom near `4096` is tight to inspect only `trulyIsolated` (`globalDegree === 0`) nodes + `hubLeafGroups`.
5. **Optional Maintenance Lock**: Run `--lock "<reason>"` before multi-step manual edits.

### Phase 2 — Hydrogen Semantic Review (Reasoning Layer)
- Review the compact `clusters` (only `!allAutoSafe`) and `items` / `hubLeafGroups` directly:
  - Merge true multi-node synonym clusters into `mergePlan` entries (`[{ "keep": "<winner_id>", "merge": ["<alias_id_1>", "<alias_id_2>"], "canonicalName": "..." }]`).
  - Synthesize typed triples (`links`) prioritizing `trulyIsolated` nodes and `hubLeafGroups` leaf pairs (`leafA --(uses|implements|depends_on)--> leafB`) using typed relations (`implements`, `configures`, `replaces`, `caused_by`, `optimizes`, `fixes`, `depends_on`, `uses`, `imports`, `modifies`, `causes`).

### Phase 3 — One-Shot Symbolic Execution (`--apply-and-compact`)
Run merges, temporal links, edge compaction, ONE snapshot rebuild, budget diff, and verification in a **single command**:
```bash
node "$SCRIPT" --apply-and-compact --merges merges.json --links links.json --auto-safe --target-reads 3800 --limit 500
# or single bundle file { mergePlan, links, autoSafeMerges } (add --dry-run to preview):
node "$SCRIPT" --apply-and-compact bundle.json --dry-run
```
(Individual commands `--dedup`, `--prune`, `--merge-plan`, `--apply-temporal`, and `--compact-edges [--apply]` remain available when needed.)
Release manual lock with `--unlock` if you called `--lock`.

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

# 3. Zero-token candidate extraction & read-budget simulation (clean JSON stdout)
node "$SCRIPT" --audit [--days 14]
node "$SCRIPT" --simulate-budget [--limit N] [--target-reads N] [--query-limit N]
node "$SCRIPT" --suggest-merges [--limit N] [--min-score S] [--same-type-only] [--auto-safe] [--clusters-only] [--full] [--minify]
node "$SCRIPT" --suggest-links [--limit N] [--pair-mode] [--full] [--minify]

# 4. Safe symbolic execution & one-shot cycle (5-layer KV + Cold Graveyard)
node "$SCRIPT" --dedup [--auto-safe]
node "$SCRIPT" --merge-plan '<json_or_file>' [--auto-safe] [--dry-run]
node "$SCRIPT" --prune [--days 14] [--include-stale] [--include-hallucinations] [--no-hallucinations]
node "$SCRIPT" --apply-temporal '<json_or_file>' [--dry-run]
node "$SCRIPT" --compact-edges [--apply] [--target-reads N] [--limit N] [--query-limit N] [--full]
node "$SCRIPT" --apply-and-compact ['<json_or_file>'] [--merges '<json_or_file>'] [--links '<json_or_file>'] [--auto-safe] [--target-reads N] [--limit N] [--dry-run] [--strict]

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
