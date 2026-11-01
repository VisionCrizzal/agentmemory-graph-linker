---
name: agentmemory-graph-linker
description: Links unlinked nodes (NO RELATIONS YET) in the AgentMemory Knowledge Graph with zero external token waste while respecting the 2048 KV read budget. Use when the user asks to link unlinked graph nodes, fix a "Sparse graph" warning on localhost:3113/#graph, or organize knowledge graph relations efficiently on lightweight models like Gemini 3.8 Flash High.
user-invocable: true
---

# AgentMemory Knowledge Graph Linker

Links isolated nodes (`NO RELATIONS YET`) in the AgentMemory Knowledge Graph (`http://localhost:3113/#graph`) in one pass without burning frontier LLM tokens.

## Quick start

```bash
# 1. Check current unlinked count in the 500-node view
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# 2. Auto-link all unlinked nodes in 1 command (0 external LLM tokens)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto

# 3. Optional: Dump unlinked nodes & front anchors for custom semantic curation
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump
```

## Why

AgentMemory's `queryGraphIndex` enforces a hard `maxReads: 2048` KV read cap per query:
1. Reading the 500 visible `pageNodes` from the LIFO `"nodes"` posting list consumes ~1,001 KV reads, leaving ~1,045 KV reads to scan node adjacency lists from `pageNodes[0]` to `pageNodes[499]`.
2. Once `remainingReads` hits `0` (around `pageNodes[60..85]`), the adjacency loop breaks early (`reader.exhausted = true`). Any node at a higher index (`pageNodes[85..499]`) appears as `unlinked` unless at least one of its edges is attached to a front-of-queue anchor (`pageNodes[0..24]`).
3. Using `POST /agentmemory/graph/extract` with the `DIRECT_GRAPH_XML` passthrough in `smart-router.mjs` preserves all node types verbatim (`concept`, `file` with or without extension, `command`, `library`, `person`, `error`, `decision`, `function`) in `<1ms` at zero cloud token cost.

## Workflow

1. **Inspect status**: Run `graph-linker.mjs --status` to check `unlinkedCount` in the top-500 slice.
2. **Choose mode**:
   - **Fast Auto Mode (Recommended)**: Run `graph-linker.mjs --auto`. The script classifies unlinked nodes by domain and connects them to matching front-of-queue anchors in `pageNodes[0..24]`, then triggers a snapshot rebuild.
   - **AI-Curated Mode (Gemini 3.8 Flash High)**:
     1. Run `graph-linker.mjs --dump` to view the `frontAnchors` (`pageNodes[0..24]`) and `unlinked` list.
     2. Map each unlinked node to a semantically appropriate anchor from `frontAnchors` using relation types `uses`, `depends_on`, `modifies`, `fixes`, `imports`, `causes`, or `related_to`.
     3. Apply via `node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply '<json_array>'`.
3. **Verify**: Confirm `unlinkedCount: 0` in the script output and refresh `http://localhost:3113/#graph`.

## Anti-patterns

- **WRONG**: Linking unlinked nodes to older hubs at `pageNodes[100..499]` or outside `pageNodes`. Those hubs are scanned after `reader.exhausted` hits `2048` KV reads, so the new edges stay invisible in the 500-node viewer.
- **RIGHT**: Always pick target anchors from `pageNodes[0..24]` (the first 25 nodes returned by `/agentmemory/graph/query`), which are scanned first while KV read budget is full.
- **WRONG**: Using `/agentmemory/graph/import-graphify` for `command`, `library`, or extensionless `file` nodes. `parseGraphifyGraph` remaps them to `concept` or `function`, creating duplicate nodes instead of linking existing ones.
- **RIGHT**: Use `/agentmemory/graph/extract` with `DIRECT_GRAPH_XML` (built into `scripts/graph-linker.mjs`), which preserves exact `node.type` and `node.name` keys.

## Checklist

- [ ] `unlinkedCount` verified via `--status` before and after linking.
- [ ] Target anchors selected exclusively from `pageNodes[0..24]`.
- [ ] Exact `type` and `name` preserved for every existing node.
- [ ] Graph snapshot rebuilt via `/agentmemory/graph/snapshot-rebuild`.

## See also

- [REFERENCE.md](REFERENCE.md) for the `maxReads: 2048` LIFO posting math and `DIRECT_GRAPH_XML` wire protocol.
- [scripts/graph-linker.mjs](scripts/graph-linker.mjs) for the executable linker implementation.
