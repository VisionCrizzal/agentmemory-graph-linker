---
name: agentmemory-graph-linker
description: Links unlinked nodes (NO RELATIONS YET), permanently deletes unwanted nodes/edges across all 5 KV layers (including facets), drains offline capture spools, inspects/heals mcp-crash.log & daemon logs with a 0-token byte-offset cursor, and beautifies layout in the AgentMemory Knowledge Graph while respecting the 4096 KV read budget. Use when the user asks to link unlinked graph nodes, delete specific graph nodes, inspect crash/daemon logs, fix a "Sparse graph" or spool warning on localhost:3113, or organize knowledge graph relations semantically.
user-invocable: true
---

# AgentMemory Knowledge Graph Linker, Cleaner & Healer (v2.2)

> **Companion Skill for [AgentMemory (`rohitg00/agentmemory`)](https://github.com/rohitg00/agentmemory)**  
> Requires [`@agentmemory/agentmemory`](https://github.com/rohitg00/agentmemory) daemon and `iii` engine running locally. Distributed under the [MIT License](./LICENSE).

Links isolated nodes (`NO RELATIONS YET`), permanently deletes unwanted nodes across all 5 storage layers (including `mem:facets`), drains offline capture spools, incrementally inspects & heals `mcp-crash.log` / daemon logs without re-reading fixed lines, and balances thematic clusters in the [AgentMemory](https://github.com/rohitg00/agentmemory) Knowledge Graph (`http://localhost:3113/#graph`) without burning frontier LLM tokens.

## Quick start

```bash
# 1. Check current unlinked count, edge diversity & cluster topology
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# 2. Beautify & Balance Layout into 6 Thematic Constellations (Recommended)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# 3. Permanently Delete Unwanted Nodes, Incident Edges & Facets across all 5 KV layers
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Node Name 1" "gn_node_id_2"

# 4. One-Shot Health Recovery (Delta log heal + drain spool + session sweep + verify index)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

# 5. Incremental Log Inspector (reads ONLY unread bytes from mcp-crash.log & daemon logs)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --logs

# 6. Dump unlinked nodes & front anchors (0..24) for custom semantic curation
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump

# 7. Apply custom semantic relations (accepts inline JSON array or JSON file path)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply /path/to/links.json

# 8. Fast Auto-Link (0 external LLM tokens)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto
```

## Why

1. **Bounded `maxReads: 4096` KV Read Cap**:
   - Reading 500 visible `pageNodes` from the LIFO `"nodes"` posting list consumes ~1,001 KV reads, leaving the remaining budget to scan node adjacency lists starting from `pageNodes[0]`.
   - Once read budget exhausts, the loop breaks early (`reader.exhausted = true`). Nodes without connections to front-of-queue anchors (`pageNodes[0..24]`) appear as isolated in the bottom grid (`NO RELATIONS YET`).
2. **5-Layer Permanent Deletion (`--delete`)**:
   - Deleting a node from `mem:graph:nodes` alone leaves a "ghost" node in the viewer because `queryGraphIndex` reads from `mem:graph:retrieval-data`.
   - `--delete` unlinks doubly-linked postings in `mem:graph:retrieval-data`, decrements `mem:graph:retrieval-control` counters, removes canonical records in `mem:graph:nodes`/`edges`/`node-degree`/`membership`/`edge-history`, cleans `mem:graph:name-index` & `mem:graph:edge-key`, purges orphaned `mem:facets` (#1642), and rebuilds `mem:graph:snapshot`.
3. **Zero-Token Incremental Log Cursor (`--logs` & `--heal`)**:
   - Tracks `ino` and byte `offset` in `~/.agentmemory/.log-heal-cursor.json` across `~/.agentmemory/mcp-crash.log` (#1662/#1674), `~/.agentmemory/mcp-crash.log.1`, `$TMPDIR/agentmemory-mcp-crash.log`, `~/Library/Logs/agentmemory.error.log`, and `~/Library/Logs/agentmemory.log`.
   - Once log entries are read and healed, the byte cursor advances to `stat.size`. Subsequent runs skip unchanged files completely (`unreadBytesRead: 0`), preventing redundant log reading and saving tokens.

## Workflow

1. **Inspect status, logs, or heal**: Run `--status`, `--logs`, or `--heal` to check unread crash/daemon logs, flush any pending capture spool, sweep abandoned sessions (#1645), and inspect `unlinkedCount`.
2. **Delete unwanted nodes (if any)**: Run `--delete "<name_or_id>"` before linking so deleted nodes and their facets do not leave orphaned neighbors.
3. **Link & Beautify**:
   - **Beautify Mode (`--beautify`)**: Classifies unlinked nodes into 6 domains (AI Models, AgentMemory Core, Mobile Ecosystem, Flutter UI, macOS Audio, Dev Tools), attaches them to front-of-queue anchors (`pageNodes[0..20]`) with semantic relations (`uses`, `depends_on`, `modifies`, `fixes`, `imports`, `causes`), and automatically sweeps any boundary nodes (`idx 475..499`) that shift into the 500-node window.
   - **AI-Curated Mode (`--dump` + `--apply`)**:
     1. Run `--dump` to inspect `frontAnchors` (`0..24`) and `unlinked`.
     2. Write semantic links (`source`, `sourceType`, `target`, `targetType`, `type`, `weight`) to a JSON file.
     3. Run `--apply /path/to/file.json`. Automatically bridges deep chains (`idx >= 25`) to `pageNodes[0..24]` and splits same-name entities with different types into non-colliding XML batches.
4. **Verify**: Run `--status` to confirm `unlinkedCount: 0` and `sparseWarningActive: false`.

## Anti-patterns

- **WRONG**: Re-reading entire `mcp-crash.log` or `agentmemory.error.log` files manually on every check, wasting context tokens on errors that were already fixed.
- **RIGHT**: Run `graph-linker.mjs --logs` (or `--heal`), which uses `~/.agentmemory/.log-heal-cursor.json` to read only new unread bytes (`0 bytes` when unchanged).
- **WRONG**: Linking unlinked nodes only to older hubs at `pageNodes[100..499]`. Those hubs are scanned after `reader.exhausted` hits the read budget, so edges stay invisible in the 500-node viewer.
- **RIGHT**: Always target anchors in `pageNodes[0..24]` (or let `--apply` auto-bridge deep chains).
- **WRONG**: Deleting nodes only in `mem:graph:nodes` without unlinking `mem:graph:retrieval-data` and `mem:facets`.
- **RIGHT**: Always use `graph-linker.mjs --delete`, which cleans all 5 storage layers.

## See also

- [REFERENCE.md](REFERENCE.md) for the `maxReads: 4096` math, 5-layer KV deletion architecture, incremental log cursor design, Smart Router v2.2 safeguards, and v2.2 changelog.
- [scripts/graph-linker.mjs](scripts/graph-linker.mjs) for the executable CLI implementation.
