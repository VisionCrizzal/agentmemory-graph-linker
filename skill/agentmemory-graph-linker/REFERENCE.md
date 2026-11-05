# AgentMemory Knowledge Graph Linker Reference (v2.2)

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

### Why Front-of-Queue Anchors (`pageNodes[0..24]`) Work

1. Both `"nodes"` and `"adjacency"` posting lists are **LIFO (newest-first) doubly-linked lists** (`root.head` is the most recently added item).
2. `pageNodes[0..24]` are the first 25 nodes scanned in `for (const node of pageNodes)`, when all KV reads are still available.
3. Any new edge attached to a node in `pageNodes[0..24]` is inserted at `root.head` of that node's `"adjacency"` list, so it is read on the first page (`limit: 64`) of the first 25 loop iterations.
4. Because `edges.set(id, edge)` registers the edge for **both** `edge.sourceNodeId` and `edge.targetNodeId`, linking `unlinkedNode` (even at `pageNodes[485]`) to an anchor in `pageNodes[0..24]` guarantees that `unlinkedNode` has a visible edge in `pageEdges`.

---

## 2. Why `DIRECT_GRAPH_XML` Beats `import-graphify` & Same-Name Batching

`POST /agentmemory/graph/import-graphify` uses `mapNodeType(file_type, label)`, which only outputs `"decision"`, `"concept"`, `"file"` (with extension), or `"function"`. Existing nodes with `type: "command"`, `"library"`, `"person"`, `"error"`, `"pattern"`, `"entity"`, or extensionless `"file"` cannot be matched in `import-graphify`.

By contrast, `POST /agentmemory/graph/extract` calls `parseGraphXml`, which reads `type` and `name` attributes verbatim when `title: "DIRECT_GRAPH_XML"` is sent (`~/.agentmemory/smart-router.mjs` echoes the XML back in `<1ms` with 0 external LLM tokens).

### Same-Name Entity Collision Fix & Surrogate-Safe Escaping (#1598)
- Inside `@agentmemory/agentmemory`, `parseGraphXml` stores `<entity>` tags in a `Map` keyed by `name` only (`entityMap.set(name, type)`). `applyDirectXmlLinks()` automatically partitions relationships into non-colliding XML batches whenever two entities share the same `name` with different `type`.
- `stripLoneSurrogates()` in `graph-linker.mjs` and `sliceHeadSurrogateSafe()` / `sliceTailSurrogateSafe()` in `smart-router.mjs` prevent lone UTF-16 surrogates (`\uD800-\uDBFF` / `\uDC00-\uDFFF`) from corrupting XML or JSON payloads (#1598).

---

## 3. 5-Layer Permanent Node, Edge & Facet Deletion (`--delete`)

AgentMemory has no built-in REST endpoint to delete individual graph nodes, and deleting or setting `stale: true` in `mem:graph:nodes` alone leaves "ghost" nodes in `/agentmemory/graph/query` because `queryGraphIndex` reads from `mem:graph:retrieval-data`.

`node graph-linker.mjs --delete "<name_or_id>"` connects directly to the `iii` engine WebSocket (`ws://127.0.0.1:49134`, namespace `agentmemory-3111`) and cleans all 5 layers:

1. **Retrieval Index Data (`mem:graph:retrieval-data`)**:
   - Computes `memberId = sha256(JSON.stringify(id))` and `recordKey = ${buildId}:record:${kind}:${memberId}`.
   - Traverses every posting in `before.postings` and unlinks `memberId` from the doubly-linked list (`${buildId}:root:${posting}` and `${buildId}:entry:${posting}:${memberId}`).
   - Sets `recordKey` to `{ row: null, postings: [], incomplete: false }` so `reader.getNode(id)` and `reader.getEdge(id)` return `null`.
2. **Retrieval Index Control (`mem:graph:retrieval-control`, key `"current"`)**:
   - Decrements `nodes`, `edges`, `nodesByType[type]`, and `edgesByType[type]`, and increments `revision`.
3. **Canonical Scopes (`mem:graph:nodes`, `mem:graph:edges`, `mem:graph:node-degree`, `mem:graph:membership`, `mem:graph:edge-history`)**:
   - Deletes the target nodes, memberships, edge histories, and all incident edges where `sourceNodeId` or `targetNodeId` matches.
4. **Lookup Indexes & Snapshot (`mem:graph:name-index`, `mem:graph:edge-key`, `mem:graph:snapshot`)**:
   - Deletes `${type}|${name}` and `${sourceNodeId}|${targetNodeId}|${type}`, then triggers `mem::graph-snapshot-rebuild` (`{ force: true }`).
5. **Facet Cleanup (`mem:facets`, v0.9.32 #1642)**:
   - Scans `mem:facets` and deletes any orphaned facet records whose `targetId` references the deleted nodes or incident edges.

---

## 4. Zero-Token Incremental Log Inspector & Self-Healer (`--logs` & `--heal`, #1662 / #1674)

In `@agentmemory/agentmemory` v0.9.32, the standalone MCP shim writes fatal crash traces (`uncaughtException`, `unhandledRejection`) to `~/.agentmemory/mcp-crash.log` (rotating to `mcp-crash.log.1` at 1 MB, with `$TMPDIR/agentmemory-mcp-crash.log` as fallback) and persists the in-memory store before exiting (#1662, #1674).

To inspect and heal errors from both MCP crash logs and daemon logs (`~/Library/Logs/agentmemory.error.log`, `~/Library/Logs/agentmemory.log`) **without ever re-reading old log entries or wasting tokens**:
- `inspectAndHealLogs()` maintains a state cursor in `~/.agentmemory/.log-heal-cursor.json` recording `{ ino, offset, mtimeMs, lastCheckedAt, lastIssuesFound }` per log file.
- When `stat.ino === prev.ino && stat.size === prev.offset`, the file is **skipped without opening or reading a single byte** (`status: "skipped_already_read"`, `unreadBytesRead: 0`).
- When new bytes are appended (`stat.size > prev.offset`), only the unread byte range `[prev.offset, stat.size)` (capped at the last 16 KB on initial scan/rotation) is read via `fs.readSync`.
- Detected error signatures (`mcp_shim_crash`, `graph_index_paused`, `llm_provider_missing`, `deprecated_openai_api_key_for_llm`, `truncated_openai_reply`, `orphan_index_shards`) automatically trigger self-healing actions, and `offset` advances to `stat.size`.

---

## 5. Smart AI Router v2.2 & `@agentmemory/agentmemory` v0.9.32 Enhancements

1. **Truncated Reply Failover Protection (#1495)**:
   - Both AgentMemory v0.9.32 and `smart-router.mjs` v2.2 guard against `finish_reason === "length"` (`max_tokens` cut-off).
   - `smart-router.mjs` v2.2 additionally inspects the returned XML structure (`<summary>...</summary>`, `<observation>...</observation>`, `<entities>...</relationships>`). If an upstream tier returns `finish_reason: "length"` or an unclosed XML tag, the router rejects that tier, places it on a 15s cooldown, and fails over to the next tier in the 11-tier chain instead of storing a truncated memory.
2. **Resource & Session Maintenance in `--heal` (#1256, #1260, #1645)**:
   - Triggers `mem::session-sweep` (#1645) to sweep abandoned `active` sessions older than the staleness cutoff (`AGENTMEMORY_SESSION_SWEEP_ENABLED`, default 24h) and request summary refresh.
   - Reads `mem:idx:bm25` key `"legacy:sweep"` to verify orphaned index generation reclamation (#1256).
   - Queries `mem::graph-stats` (#1260) for bounded MCP graph statistics without full-table scans.
3. **Additional v0.9.32 Capabilities Available to Agents**:
   - **`sourceIds` on `memory_lesson_save` (#1661)**: Pass `sourceIds: ["mem_...", "obs_..."]` when calling `memory_lesson_save` to link reusable lessons directly to their source memories/observations.
   - **CJK & Multilingual Recall (#1553), Scoped `memory_smart_search` Ranking (#1669), Project Isolation (#1647), and Memory Types in Search Responses (#1646)**.
   - **MCP Tool Annotations (#1664) & `AGENTMEMORY_SLOTS` Guard (#1659)**: 24 read-only tools and 9 destructive tools carry `readOnlyHint`/`destructiveHint`, and slot tools stay hidden unless `AGENTMEMORY_SLOTS=true`.
   - **Companion Packages**: `@agentmemory/pi` (`v0.1.1`) and `@agentmemory/fs-watcher` (`v0.2.0`).

---

## 6. Changelog

### v2.2 (2026-11-05)
- **Zero-Token Incremental Log Inspector (`--logs` & integrated in `--heal`, #1662 / #1674)**:
  - Connects to `~/.agentmemory/mcp-crash.log`, `mcp-crash.log.1`, `$TMPDIR/agentmemory-mcp-crash.log`, `~/Library/Logs/agentmemory.error.log`, and `~/Library/Logs/agentmemory.log`.
  - Saves `{ ino, offset, mtimeMs }` in `~/.agentmemory/.log-heal-cursor.json` so already-read and already-fixed log entries are skipped with `0 bytes` read on subsequent runs.
- **Smart AI Router v2.2 (`smart-router.mjs`)**:
  - Added **Truncated Reply Failover (#1495)**: automatically detects `finish_reason === "length"` and unclosed `<summary>`, `<observation>`, or `<entities>` XML tags and fails over to the next LLM tier instead of storing truncated completions.
  - Added **Surrogate-Safe UTF-16 Slicing (#1598)**: `sliceHeadSurrogateSafe()` and `sliceTailSurrogateSafe()` prevent splitting surrogate pairs during prompt compaction (`12,000` chars) and fallback synthesis.
- **5-Layer `--delete` with Facet & Membership Cleanup (#1642)**:
  - Extended `--delete` to purge orphaned `mem:facets`, `mem:graph:membership`, and `mem:graph:edge-history` records referencing deleted nodes or edges.
- **Enhanced `--heal` Resource Maintenance (#1256, #1260, #1645, #1664)**:
  - Automatically triggers `mem::session-sweep` for abandoned sessions (#1645), checks `mem:idx:bm25` `"legacy:sweep"` for orphaned index generation reclamation (#1256), queries bounded `mem::graph-stats` (#1260), and strips deprecated `OPENAI_API_KEY_FOR_LLM` from `.env` (#1664).

### v2.1 (2026-11-05)
- **Self-Healing `maxReads: 4096` & `AGENTMEMORY_LLM_PROVIDER` in `--heal` and `install.sh`**.
- **Auto-Resume Paused Graph Index in `--heal`**.
- **Synced Official AgentMemory Skills (`0.9.32`)**.

### v2.0 (2026-11-05)
- **Added `--delete "<name_or_id>"`**, **`--heal` / `--drain`**, **Auto-Anchor Visibility Protection**, **Same-Name Entity Collision Batching**, and **Multi-Pass Boundary Sweep**.
