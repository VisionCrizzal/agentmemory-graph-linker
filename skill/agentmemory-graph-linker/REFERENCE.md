# AgentMemory Knowledge Graph Linker Reference

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

---

## 3. Thematic Constellations, Degree Balancing & D3 Canvas Physics

The `@agentmemory/agentmemory` web viewer (`http://localhost:3113/#graph`) runs an iterative 2D physics simulation on HTML5 Canvas:
- **Repulsion (Coulomb Force)**: `f = (repulse * alpha) / d2` pushes all nodes apart.
- **Attraction (Hooke Springs)**: `k = ((d - rest) / d) * 0.08 * alpha` pulls connected nodes together with target distance `rest = 70 + r1 + r2`.
- **Node Radii**: `r = Math.min(18, 6 + Math.sqrt(degree) * 3.2)` scales smoothly from 6px to 18px.
- **Edge Dashes & Colors**:
  - `uses`: solid line `[]`
  - `imports`: long dash `[7, 4]`
  - `related_to`: dotted line `[2, 3]`
  - `depends_on`: dash-dot line `[9, 3, 2, 3]`
  - `modifies`: short dash `[1, 4]`
  - `fixes`: medium dash `[4, 2]`

### How `--beautify` Prevents the "Hairball" Effect

If 100+ nodes connect to a single hub, they collapse into an unreadable ball. `--beautify` enforces two topological constraints:
1. **The 6 Domain Constellations**: Nodes are classified by domain keywords into:
   - 🤖 **AI Models & Smart Router**
   - 🧠 **AgentMemory System Core**
   - 📱 **Mobile & Remote AI Ecosystem**
   - 🎨 **Flutter Architecture & UI**
   - 💻 **macOS CoreAudio & Hardware**
   - 🛠️ **Dev Tools & Automation**
2. **Anchor Degree Capping**: Main anchors accept a maximum of 25 direct leaf edges before spilling over to domain sub-anchors, ensuring no node balloons past 18px radius.
3. **Central Backbone Bridges**: Connects the 6 domain anchors to each other in an interconnected ring, keeping all clusters in orbit around the center rather than floating off-screen.
