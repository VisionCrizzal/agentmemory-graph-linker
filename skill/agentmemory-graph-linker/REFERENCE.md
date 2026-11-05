# AgentMemory Knowledge Graph Linker Reference (v2.0)

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

### Auto-Anchor Visibility Protection in `--apply` (v2.0)

When curating semantic chains where `NodeA (idx 488) -> NodeB (idx 486)`, neither endpoint is in `pageNodes[0..24]`. Because `pageNodes[486]` is never reached before `reader.exhausted`, that edge would remain unread in the 500-node viewer.
- `graph-linker.mjs --apply` v2.0 automatically detects when neither `source` nor `target` is in `pageNodes[0..24]` and injects a secondary semantic bridge from `source` to a matching front anchor in `pageNodes[0..24]`.

---

## 2. Why `DIRECT_GRAPH_XML` Beats `import-graphify` & Same-Name Batching

`POST /agentmemory/graph/import-graphify` uses `mapNodeType(file_type, label)`, which only outputs `"decision"`, `"concept"`, `"file"` (with extension), or `"function"`. Existing nodes with `type: "command"`, `"library"`, `"person"`, `"error"`, `"pattern"`, `"entity"`, or extensionless `"file"` cannot be matched in `import-graphify`.

By contrast, `POST /agentmemory/graph/extract` calls `parseGraphXml`, which reads `type` and `name` attributes verbatim when `title: "DIRECT_GRAPH_XML"` is sent (`~/.agentmemory/smart-router.mjs` echoes the XML back in `<1ms` with 0 external LLM tokens).

### Same-Name Entity Collision Fix (v2.0)
Inside `@agentmemory/agentmemory`, `parseGraphXml` stores `<entity>` tags in a `Map` keyed by `name` only (`entityMap.set(name, type)`). If a single XML payload contains `<entity type="entity" name="Zalo"/>` and `<entity type="library" name="Zalo"/>`, the second overwrites the first's type.
- `applyDirectXmlLinks()` in `graph-linker.mjs` v2.0 automatically partitions relationships into non-colliding XML batches whenever two entities share the same `name` with different `type`.

---

## 3. 4-Layer Permanent Node & Edge Deletion (`--delete`)

AgentMemory has no built-in REST endpoint to delete individual graph nodes, and deleting or setting `stale: true` in `mem:graph:nodes` alone leaves "ghost" nodes in `/agentmemory/graph/query` because `queryGraphIndex` reads from `mem:graph:retrieval-data`.

`node graph-linker.mjs --delete "<name_or_id>"` connects directly to the `iii` engine WebSocket (`ws://127.0.0.1:49134`, namespace `agentmemory-3111`) and cleans all 4 layers:

1. **Retrieval Index Data (`mem:graph:retrieval-data`)**:
   - Computes `memberId = sha256(JSON.stringify(id))` and `recordKey = ${buildId}:record:${kind}:${memberId}`.
   - Traverses every posting in `before.postings` and unlinks `memberId` from the doubly-linked list (`${buildId}:root:${posting}` and `${buildId}:entry:${posting}:${memberId}`).
   - Sets `recordKey` to `{ row: null, postings: [], incomplete: false }` so `reader.getNode(id)` and `reader.getEdge(id)` return `null`.
2. **Retrieval Index Control (`mem:graph:retrieval-control`, key `"current"`)**:
   - Decrements `nodes`, `edges`, `nodesByType[type]`, and `edgesByType[type]`, and increments `revision`.
3. **Canonical Scopes (`mem:graph:nodes`, `mem:graph:edges`, `mem:graph:node-degree`)**:
   - Deletes the target nodes and all incident edges where `sourceNodeId` or `targetNodeId` matches.
4. **Lookup Indexes & Snapshot (`mem:graph:name-index`, `mem:graph:edge-key`, `mem:graph:snapshot`)**:
   - Deletes `${type}|${name}` and `${sourceNodeId}|${targetNodeId}|${type}`, then triggers `mem::graph-snapshot-rebuild` (`{ force: true }`).

---

## 4. Offline Capture Spool & Health Recovery (`--heal`)

When hooks execute while the AgentMemory server is restarting, observations are queued in the local capture spool (`~/.agentmemory/`).
- `node graph-linker.mjs --heal` (or `--drain`) calls `POST /agentmemory/capture/drain`, verifies `GET /agentmemory/graph/index`, rebuilds the graph snapshot, and reports current `unlinkedCount`.
- Note: The doctor `[INFO]` message `N documents are waiting for a vector embedding` is normal by design (`AGENTMEMORY_VECTOR_BACKFILL` is paused by default to avoid startup token/API drain; FTS5 keyword search and Knowledge Graph queries operate at 100% without historical vector backfill).

---

## 5. Changelog

### v2.0 (2026-11-05)
- **Added `--delete "<name_or_id>"`**: 4-layer permanent deletion of nodes and incident edges across `mem:graph:retrieval-data`, `mem:graph:retrieval-control`, `mem:graph:nodes`/`edges`/`node-degree`, `mem:graph:name-index`/`edge-key`, and `mem:graph:snapshot`.
- **Added `--heal` / `--drain`**: One-shot maintenance command to drain the offline capture spool (`/agentmemory/capture/drain`), verify retrieval index status, and rebuild the graph snapshot.
- **Upgraded `--apply`**:
  - Supports both inline JSON strings and JSON file paths.
  - Added **Auto-Anchor Visibility Protection** so deep chains (`idx >= 25`) automatically get a front-anchor bridge in `pageNodes[0..24]`.
  - Added **Same-Name Entity Collision Batching** in `applyDirectXmlLinks()` so nodes sharing a name with different types (e.g. `Zalo` as `entity` vs `library`) never collide in `parseGraphXml`.
- **Upgraded `--beautify` & Semantic Classifier**:
  - Fixed bug where `decision` nodes returned `"optimizes_for"` (which was downgraded to `"related_to"` by `normalizeRelation`).
  - Anchors directly into live front-of-queue nodes (`pageNodes[0..20]`) and runs multi-pass boundary sweeps (`idx 475..499`) until `unlinkedCount === 0`.
- **Upgraded `--dump`**: Expanded `frontAnchors` output to 25 nodes (`pageNodes[0..24]`).
