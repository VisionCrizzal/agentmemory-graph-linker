# AgentMemory Knowledge Graph Linker Reference

## 1. The `maxReads: 2048` KV Budget Architecture

In `@agentmemory/agentmemory` (`dist/index.mjs`, `queryGraphIndex`), every call to `POST /agentmemory/graph/query` with `{"limit": 500}` creates a bounded `GraphIndexReader`:

```js
const reader = await createGraphIndexReader(state, {
  maxReads: 2048,
  maxBytes: 4 * 1024 * 1024
});
```

### Read Budget Breakdown

| Operation | KV Reads Consumed | Remaining Reads |
| :--- | :--- | :--- |
| Read index status & generation | `2` | `2046` |
| Read 500 node IDs from `"nodes"` LIFO posting list | `501` | `1545` |
| Fetch 500 node records via `reader.getNode(id)` | `500` | `1045` |
| Scan `"adjacency"` lists for `pageNodes[0..k]` | `1 + 2 * degree` per node | Exhausts at `~480` edges |
| Final consistency check in `reader.finish()` | `2` | `0` |

When `this.remainingReads === 0`, `reader.exhausted` becomes `true` and `for (const node of pageNodes)` breaks immediately:

```js
if (cursor || reader.exhausted) {
  truncated = true;
  break;
}
```

### Why Front-of-Queue Anchors (`pageNodes[0..24]`) Work

1. Both `"nodes"` and `"adjacency"` posting lists are **LIFO (newest-first) doubly-linked lists** (`root.head` is the most recently added item).
2. `pageNodes[0..24]` are the first 25 nodes scanned in `for (const node of pageNodes)`, when all `~1,045` KV reads are still available.
3. Any new edge attached to a node in `pageNodes[0..24]` is inserted at `root.head` of that node's `"adjacency"` list, so it is read on the first page (`limit: 64`) of the first 25 loop iterations.
4. Because `edges.set(id, edge)` registers the edge for **both** `edge.sourceNodeId` and `edge.targetNodeId`, linking `unlinkedNode` (even at `pageNodes[450]`) to an anchor in `pageNodes[0..24]` guarantees that `unlinkedNode` has a visible edge in `pageEdges`.

---

## 2. Why `DIRECT_GRAPH_XML` Beats `import-graphify`

`POST /agentmemory/graph/import-graphify` uses `mapNodeType(file_type, label)`:
- It only outputs `"decision"`, `"concept"`, `"file"` (only if `label` matches `/\.[a-z0-9]{1,10}$/i`), or `"function"`.
- Existing nodes with `type: "command"`, `type: "library"`, `type: "person"`, `type: "error"`, or `type: "file"` without a file extension (e.g. `/usr/bin/log`, `/Library/Audio/Plug-Ins/HAL/`) cannot be matched by `nameIndexKey(node.type, node.name)` in `import-graphify`.

By contrast, `POST /agentmemory/graph/extract` calls `parseGraphXml`, which reads `type` and `name` attributes verbatim:

```xml
<entities>
  <entity type="command" name="list_gemini_config"/>
  <entity type="concept" name="call_mcp_tool"/>
</entities>
<relationships>
  <relationship type="related_to" source="list_gemini_config" target="call_mcp_tool" weight="0.9"/>
</relationships>
```

When `title: "DIRECT_GRAPH_XML"` is passed in the observation payload to `/agentmemory/graph/extract`, `~/.agentmemory/smart-router.mjs` intercepts the `DIRECT_GRAPH_XML` marker and echoes the `<entities>...<relationships>` XML back in `<1ms` without calling any external LLM API.
