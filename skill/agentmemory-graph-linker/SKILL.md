---
name: agentmemory-graph-linker
description: Links unlinked nodes (NO RELATIONS YET) in the AgentMemory Knowledge Graph with zero external token waste while respecting the 2048/4096 KV read budget. Use when the user asks to link unlinked graph nodes, fix a "Sparse graph" warning on localhost:3113/#graph, beautify graph layout, or organize knowledge graph relations efficiently on lightweight models like Gemini 3.8 Flash High.
user-invocable: true
---

# AgentMemory Knowledge Graph Linker & Beautifier

Links isolated nodes (`NO RELATIONS YET`) and balances thematic clusters in the AgentMemory Knowledge Graph (`http://localhost:3113/#graph`) in one pass without burning frontier LLM tokens.

## Quick start

```bash
# 1. Check current unlinked count & cluster topology
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# 2. Fast Auto-Link (0 external LLM tokens)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto

# 3. Beautify & Balance Layout into 6 Thematic Constellations (Recommended)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# 4. Optional: Dump unlinked nodes & front anchors for custom semantic curation
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump
```

## Why

AgentMemory's `queryGraphIndex` enforces a bounded `maxReads` KV read cap (2048 default, upgraded to 4096):
1. Reading 500 visible `pageNodes` from the LIFO `"nodes"` posting list consumes ~1,001 KV reads, leaving the remaining budget to scan node adjacency lists from `pageNodes[0]` to `pageNodes[499]`.
2. Once read budget exhausts, the loop breaks early (`reader.exhausted = true`). Nodes without connections to front-of-queue anchors (`pageNodes[0..24]`) appear as isolated in the bottom grid (`NO RELATIONS YET`).
3. If all nodes connect to just 1 or 2 hubs, the D3/canvas force simulation collapses into a crowded "hairball".
4. `--beautify` divides the graph into **6 balanced domain constellations** connected by a central inter-cluster backbone, capping each hub's degree to prevent black-hole crowding and assigning semantically rich edge types (`uses`, `modifies`, `imports`, `depends_on`, `fixes`, `causes`).

## Workflow

1. **Inspect status**: Run `graph-linker.mjs --status` to check `unlinkedCount` and edge type distribution.
2. **Choose mode**:
   - **Beautify Mode (Recommended)**: Run `graph-linker.mjs --beautify`. Balances nodes across the 6 major domains (AI Models, AgentMemory Core, Mobile Ecosystem, Flutter UI, macOS Audio, Dev Tools), connects domain anchors with backbone bridges, and adds rich semantic relationships.
   - **Fast Auto Mode**: Run `graph-linker.mjs --auto` for simple progressive convergence.
   - **AI-Curated Mode (Gemini 3.8 Flash High)**:
     1. Run `graph-linker.mjs --dump` to view the `frontAnchors` and `unlinked` list.
     2. Map unlinked nodes to semantic anchors using relation types `uses`, `depends_on`, `modifies`, `fixes`, `imports`, `causes`, or `related_to`.
     3. Apply via `node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply '<json_array>'`.
3. **Verify**: Refresh `http://localhost:3113/#graph` and observe the circular constellation layout with distinct edge dashes.

## Anti-patterns

- **WRONG**: Linking unlinked nodes to older hubs at `pageNodes[100..499]` or outside `pageNodes`. Those hubs are scanned after `reader.exhausted` hits the read budget, so edges stay invisible in the 500-node viewer.
- **RIGHT**: Always pick target anchors from `pageNodes[0..24]` (the first 25 nodes returned by `/agentmemory/graph/query`).
- **WRONG**: Concentrating 100+ edges onto a single hub, creating a chaotic hairball.
- **RIGHT**: Use `--beautify` to cap anchor degree at 25 and spill over into domain sub-anchors.
- **WRONG**: Using `/agentmemory/graph/import-graphify` for `command`, `library`, or extensionless `file` nodes (creates duplicate nodes).
- **RIGHT**: Use `/agentmemory/graph/extract` with `DIRECT_GRAPH_XML` (built into `graph-linker.mjs`), which preserves exact `node.type` and `node.name` keys.

## Checklist

- [ ] `unlinkedCount` verified via `--status` before and after linking.
- [ ] Central backbone bridges established between domain hubs.
- [ ] Exact `type` and `name` preserved for every existing node.
- [ ] Graph snapshot rebuilt via `/agentmemory/graph/snapshot-rebuild`.

## See also

- [REFERENCE.md](REFERENCE.md) for the `maxReads: 4096` math, LIFO posting lists, and D3 canvas physics.
- [scripts/graph-linker.mjs](scripts/graph-linker.mjs) for the executable CLI implementation.
