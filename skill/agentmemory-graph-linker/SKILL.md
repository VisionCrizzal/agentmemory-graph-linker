---
name: agentmemory-graph-linker
description: Links unlinked nodes (NO RELATIONS YET), permanently deletes unwanted nodes/edges across all 4 KV layers, drains offline capture spools, and beautifies layout in the AgentMemory Knowledge Graph with zero external token waste while respecting the 2048/4096 KV read budget. Use when the user asks to link unlinked graph nodes, delete specific graph nodes, fix a "Sparse graph" or spool warning on localhost:3113, or organize knowledge graph relations semantically.
user-invocable: true
---

# AgentMemory Knowledge Graph Linker, Cleaner & Healer (v2.0)

Links isolated nodes (`NO RELATIONS YET`), permanently deletes unwanted nodes across all 4 storage layers, drains offline capture spools, and balances thematic clusters in the AgentMemory Knowledge Graph (`http://localhost:3113/#graph`) without burning frontier LLM tokens.

## Quick start

```bash
# 1. Check current unlinked count, edge diversity & cluster topology
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# 2. Beautify & Balance Layout into 6 Thematic Constellations (Recommended)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# 3. Permanently Delete Unwanted Nodes & Incident Edges across all 4 KV layers
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Node Name 1" "gn_node_id_2"

# 4. One-Shot Health Recovery (Drain offline spool + verify index + rebuild snapshot)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

# 5. Dump unlinked nodes & front anchors (0..24) for custom semantic curation
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump

# 6. Apply custom semantic relations (accepts inline JSON array or JSON file path)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply /path/to/links.json

# 7. Fast Auto-Link (0 external LLM tokens)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto
```

## Why

AgentMemory's `queryGraphIndex` enforces a bounded `maxReads: 4096` KV read cap:
1. Reading 500 visible `pageNodes` from the LIFO `"nodes"` posting list consumes ~1,001 KV reads, leaving the remaining budget to scan node adjacency lists starting from `pageNodes[0]`.
2. Once read budget exhausts, the loop breaks early (`reader.exhausted = true`). Nodes without connections to front-of-queue anchors (`pageNodes[0..24]`) appear as isolated in the bottom grid (`NO RELATIONS YET`).
3. Deleting a node from `mem:graph:nodes` alone leaves a "ghost" node in the viewer because `queryGraphIndex` reads from `mem:graph:retrieval-data`. `--delete` unlinks the doubly-linked postings in `mem:graph:retrieval-data`, decrements `mem:graph:retrieval-control` counters, removes canonical records in `mem:graph:nodes`, `mem:graph:edges`, `mem:graph:name-index`, and `mem:graph:edge-key`, and rebuilds `mem:graph:snapshot`.

## Workflow

1. **Inspect status or heal**: Run `--status` or `--heal` to flush any pending capture spool and inspect `unlinkedCount`.
2. **Delete unwanted nodes (if any)**: Run `--delete "<name_or_id>"` before linking so deleted nodes do not leave orphaned neighbors.
3. **Link & Beautify**:
   - **Beautify Mode (`--beautify`)**: Classifies unlinked nodes into 6 domains (AI Models, AgentMemory Core, Mobile Ecosystem, Flutter UI, macOS Audio, Dev Tools), attaches them to front-of-queue anchors (`pageNodes[0..20]`) with semantic relations (`uses`, `depends_on`, `modifies`, `fixes`, `imports`, `causes`), and automatically sweeps any boundary nodes (`idx 475..499`) that shift into the 500-node window.
   - **AI-Curated Mode (`--dump` + `--apply`)**:
     1. Run `--dump` to inspect `frontAnchors` (`0..24`) and `unlinked`.
     2. Write semantic links (`source`, `sourceType`, `target`, `targetType`, `type`, `weight`) to a JSON file.
     3. Run `--apply /path/to/file.json`. v2.0 automatically protects chained deep links (`idx >= 25`) with a front-anchor visibility bridge and splits batches if two entities share the same `name` with different `type`.
4. **Verify**: Run `--status` to confirm `unlinkedCount: 0` and `sparseWarningActive: false`.

## Anti-patterns

- **WRONG**: Linking unlinked nodes only to older hubs at `pageNodes[100..499]`. Those hubs are scanned after `reader.exhausted` hits the read budget, so edges stay invisible in the 500-node viewer.
- **RIGHT**: Always target anchors in `pageNodes[0..24]` (or let `--apply` v2.0 auto-bridge deep chains).
- **WRONG**: Putting two entities with the same `name` and different `type` (e.g. `Zalo` as `entity` and `Zalo` as `library`) into a single manual `<entities>` XML payload (`parseGraphXml` keys entities by `name` only).
- **RIGHT**: Use `graph-linker.mjs --apply`, which automatically splits same-name entities into separate non-colliding XML batches.
- **WRONG**: Deleting nodes only in `mem:graph:nodes` or setting `stale: true` without unlinking `mem:graph:retrieval-data`.
- **RIGHT**: Always use `graph-linker.mjs --delete`, which cleans all 4 storage layers.

## See also

- [REFERENCE.md](REFERENCE.md) for the `maxReads: 4096` math, 4-layer KV deletion architecture, same-name XML batching, and v2.0 changelog.
- [scripts/graph-linker.mjs](scripts/graph-linker.mjs) for the executable CLI implementation.
