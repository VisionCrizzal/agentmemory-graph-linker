---
name: agentmemory-graph-linker
description: Links unlinked nodes (NO RELATIONS YET), freezes background LLM graph pollution via --lock/--unlock maintenance mode, audits & filters 0-token CJK & off-domain hallucinations, deduplicates errors & XML-escaped clones across all 5 KV layers, renames nodes atomically, safely prunes transient noise into Cold Graveyard (graveyard.jsonl) with lossless --restore, optimizes iii-engine RAM, inspects/heals mcp-crash.log & daemon logs with a 0-token byte-offset cursor, and beautifies layout in the AgentMemory Knowledge Graph while respecting the 4096 KV read budget.
user-invocable: true
---

# AgentMemory Knowledge Graph Linker, Deduplicator, Cleaner & RAM Optimizer (v3.1)

> **Companion Skill for [AgentMemory (`rohitg00/agentmemory`)](https://github.com/rohitg00/agentmemory)**  
> Requires [`@agentmemory/agentmemory`](https://github.com/rohitg00/agentmemory) daemon and `iii` engine running locally. Distributed under the [MIT License](./LICENSE).

Links isolated nodes (`NO RELATIONS YET`), freezes background LLM extraction during graph work via **Maintenance Lock** (`--lock`/`--unlock`), audits and filters free-LLM & unmapped CJK hallucinations at 0 token cost, merges duplicate error/entity nodes across all 5 KV storage layers, renames nodes in-place without breaking index postings, safely archives transient scratch nodes into a lossless Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) with `--restore`, optimizes `iii-engine` RAM footprint, incrementally inspects & heals `mcp-crash.log` / daemon logs with a 0-token byte-offset cursor, and balances thematic clusters in the [AgentMemory](https://github.com/rohitg00/agentmemory) Knowledge Graph (`http://localhost:3113/#graph`).

## Quick start

```bash
# 1. Check current unlinked count, edge diversity, lock state & cluster topology
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# 2. Freeze background LLM graph extraction during manual graph maintenance (0ms, 0 tokens)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --lock "Manual refactoring"
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --unlock

# 3. Dry-Run Audit: detect XML-entity clones, duplicate error groups, unmapped CJK / off-domain hallucinations & scratch noise (0 destructive changes)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --audit

# 4. 5-Layer Atomic Deduplication: merge Sentry-style error duplicates & XML-escaped clones into canonical nodes (auto-maps technical CJK to English)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dedup

# 5. 5-Layer Atomic In-Place Rename (or automatic merge if target name already exists)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --rename "Old Node Name or gn_id" "Clean New Name"

# 6. Safe Prune to Cold Graveyard (~/.agentmemory/graveyard.jsonl) with Immunity Whitelist protection (includes hallucinations & CJK junk)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --prune

# 7. Lossless Restore from Cold Graveyard (--list, --last, or specific node name/ID)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --restore --list
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --restore "Node Name or gn_id"

# 8. One-Shot RAM & Store Optimizer (auto-locks + tunes .env + patches XML parser + dedups + prunes scratch to graveyard + sweeps sessions)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --optimize-ram

# 9. Beautify & Balance Layout into 6 Thematic Constellations (Auto-locks during execution; Recommended)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# 10. Permanently Delete Specific Nodes, Incident Edges & Facets (backed up to graveyard.jsonl)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Node Name 1" "gn_node_id_2"

# 11. One-Shot Health Recovery (Delta log heal + drain spool + session sweep + verify index)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

# 12. Incremental Log Inspector (reads ONLY unread bytes from mcp-crash.log & daemon logs)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --logs

# 13. Dump unlinked nodes & front anchors (0..24) or apply custom JSON relations
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply /path/to/links.json

# 14. Fast Auto-Link (0 external LLM tokens)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto
```

## Why v3.1

1. **Maintenance Lock Mode (`--lock` & `--unlock`)**:
   - Creates a temporary lock flag (`~/.agentmemory/maintenance.lock`). When active, `smart-router.mjs` immediately short-circuits any background LLM graph extraction requests from AgentMemory with empty XML tags (`<entities></entities><relations></relations>`) at **0ms latency and 0 tokens**. Auto-locks during `--beautify` and `--optimize-ram` so background LLMs never inject phantom nodes while you're restructuring the graph.
2. **CJK & Off-Domain Foreign Language Gate**:
   - Rejects unmapped CJK characters (e.g. OCR weight tags, Chinese model card blurbs) at the router gate and audit level, while auto-mapping known tech concepts (e.g. `多Token预测` -> `Multi-Token Prediction (MTP)`, `逆向工程` -> `Reverse Engineering`). Eliminates bizarre music/hallucination connections (e.g. `Hollywood Tonight` vs `MAX_DIM`).
3. **Zero-Token Hallucination & Provenance Audit (`--audit`)**:
   - Cross-references node names against the entire local observation, memory, and summary corpus (`mem:obs:*`, `mem:memories`, `mem:summaries`) plus a comprehensive Tech Lexicon and off-domain hallucination filter. Catches free-LLM hallucinations in `<400ms` with **0 API calls and 0 LLM tokens**.
4. **Sentry-Style Error Fingerprinting & 5-Layer Atomic Merge/Rename (`--dedup` & `--rename`)**:
   - Collapses repetitive error nodes (e.g., 17 variants of `ProcessException: exit code 72 ... xcodebuild`) and case/XML-entity duplicates into a single Canonical Node, re-pointing incident edges, incrementing `properties.occurrences`, and updating all 5 KV layers.
5. **Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) & Immunity Whitelist (`--prune` & `--restore`)**:
   - Protects critical knowledge via an **Immunity Whitelist** (`decision`, `preference`, `pattern`, `person`, `project`, `milestone`, any `error` node with a `fixes` edge, and `degree >= 4` hubs).
   - Evicts transient scratch nodes, hallucinations, and unmapped foreign language noise out of `iii-engine` RAM into `graveyard.jsonl`.
6. **Real `iii-engine` RAM Reduction (`--optimize-ram`)**:
   - Targets the Rust `iii-engine` in-memory KV state by freeing tens of thousands of doubly-linked posting list records in `mem:graph:retrieval-data` and tuning `MAX_OBS_PER_SESSION=800` & `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500` in `~/.agentmemory/.env`.

## Workflow

1. **Inspect status or run audit**: Run `--status` or `--audit` to inspect unlinked nodes, duplicate groups, hallucinations, and transient scratch noise.
2. **Optimize & Deduplicate**: Run `--optimize-ram` (or `--dedup` + `--prune`) to merge duplicate nodes, clean XML entity corruption, and archive scratch noise to `graveyard.jsonl`.
3. **Rename or Restore (if needed)**: Use `--rename "<old>" "<new>"` to fix node names across all 5 KV layers, or `--restore "<name_or_id>"` to recover any archived node from `graveyard.jsonl`.
4. **Link & Beautify**: Run `--beautify` (or `--auto`) to connect all unlinked nodes into 6 balanced thematic constellations.

## See also

- [REFERENCE.md](REFERENCE.md) for the 5-layer KV engine math (`projectRecord` + `applyRetrievalRecord`), Cold Graveyard schema, Provenance Audit design, and v3.0 changelog.
- [scripts/graph-linker.mjs](scripts/graph-linker.mjs) for the executable CLI implementation.
