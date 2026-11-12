import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAX_GRAPH_READS,
  MIN_SAFE_DEGREE,
  estimateSubgraphReadCost,
  runBudgetSimulation,
  compactRedundantEdges
} from "../skill/agentmemory-graph-linker/scripts/edge-compactor.mjs";

function createMockEngine({ nodes = [], edges = [], control = { nodes: nodes.length, edges: edges.length } } = {}) {
  const store = new Map();
  const calls = {
    kvSet: [],
    kvDelete: [],
    applyRetrievalRecord: []
  };

  store.set("mem:graph:nodes", new Map(nodes.map((n) => [n.id, structuredClone(n)])));
  store.set("mem:graph:edges", new Map(edges.map((e) => [e.id, structuredClone(e)])));
  store.set(
    "mem:graph:edge-key",
    new Map(edges.map((e) => [`${e.sourceNodeId}|${e.targetNodeId}|${e.type}`, e.id]))
  );
  store.set(
    "mem:graph:edge-history",
    new Map(edges.map((e) => [e.id, [{ edgeId: e.id, type: e.type }]]))
  );
  store.set("mem:graph:node-degree", new Map());
  store.set("mem:graph:retrieval-control", new Map([["current", structuredClone(control)]]));

  return {
    store,
    calls,
    async kvList(bucket) {
      const m = store.get(bucket);
      return m ? Array.from(m.values()) : [];
    },
    async kvGet(bucket, key) {
      return store.get(bucket)?.get(key) ?? null;
    },
    async kvSet(bucket, key, val) {
      calls.kvSet.push([bucket, key, val]);
      if (!store.has(bucket)) store.set(bucket, new Map());
      store.get(bucket).set(key, structuredClone(val));
    },
    async kvDelete(bucket, key) {
      calls.kvDelete.push([bucket, key]);
      store.get(bucket)?.delete(key);
    },
    async applyRetrievalRecord(ctrl, kind, id, record) {
      calls.applyRetrievalRecord.push([kind, id, record]);
      const next = {
        ...(ctrl || {}),
        edges: Math.max(0, (ctrl?.edges ?? edges.length) - (record === null && kind === "edge" ? 1 : 0))
      };
      return { next };
    }
  };
}

test("estimateSubgraphReadCost calculates exact GraphIndexReader budget math and detects truncation", () => {
  const n1 = { id: "n1", name: "hub", type: "project" };
  const n2 = { id: "n2", name: "leafA", type: "concept" };
  const n3 = { id: "n3", name: "leafB", type: "file" };

  // Global degrees: n1=3, n2=2, n3=1 (e3 links n2-n3, plus n1-n2 strong, n1-n2 weak, n1-n3 weak -> wait: let's make distinct edges)
  const edges = [
    { id: "e1", sourceNodeId: "n1", targetNodeId: "n2", type: "fixes", weight: 0.9 },
    { id: "e2", sourceNodeId: "n1", targetNodeId: "n2", type: "related_to", weight: 0.4 },
    { id: "e3", sourceNodeId: "n1", targetNodeId: "n3", type: "related_to", weight: 0.4 }
  ];
  // pageNodes = [n1, n2] -> 2 unique nodes
  // globalDeg(n1) = 3 -> 1 + 2*3 = 7
  // globalDeg(n2) = 2 -> 1 + 2*2 = 5
  // formula: 2 + 2 + 1 + 2 + (7 + 5) = 19
  const cost = estimateSubgraphReadCost([n1, n2, n1], edges);

  assert.equal(cost.maxReads, MAX_GRAPH_READS);
  assert.equal(cost.pageNodeCount, 2);
  assert.equal(cost.totalGlobalDegree, 5);
  assert.equal(cost.adjacencyReads, 12);
  assert.equal(cost.estimatedReads, 19);
  assert.equal(cost.wouldTruncate, false);
  assert.equal(cost.headroomReads, MAX_GRAPH_READS - 19);
  assert.equal(cost.hotHubs[0].id, "n1");
  assert.equal(cost.hotHubs[0].globalDeg, 3);
  assert.equal(cost.hotHubs[0].lowWeightHeuristicCount, 2);
  assert.equal(cost.hotHubs[0].strongEdgeCount, 1);

  const tightCost = estimateSubgraphReadCost([n1, n2], edges, { maxReads: 18 });
  assert.equal(tightCost.wouldTruncate, true);
  assert.equal(tightCost.headroomReads, -1);
});

test("compactRedundantEdges (dryRun: true) respects minDegree >= 2, never orphans nodes, and never mutates mock KV", async () => {
  const nodes = [
    { id: "hub", name: "AgentMemory", type: "project" },
    { id: "safeNeighbor", name: "SmartRouter", type: "component" },
    { id: "deg2Neighbor", name: "FragileDeg2", type: "concept" },
    { id: "deg1Neighbor", name: "LeafDeg1", type: "concept" },
    { id: "aux1", name: "Aux1", type: "file" },
    { id: "aux2", name: "Aux2", type: "file" },
    { id: "aux3", name: "Aux3", type: "file" },
    { id: "weakOnlyHub", name: "WeakHubDeg5", type: "concept" }
  ];

  const edges = [
    // Hub strong + safe removable edges to safeNeighbor (safeNeighbor has deg=3 -> can drop 1, NOT 2)
    { id: "e-strong", sourceNodeId: "hub", targetNodeId: "safeNeighbor", type: "fixes", weight: 0.9 },
    { id: "e-safe-1", sourceNodeId: "hub", targetNodeId: "safeNeighbor", type: "related_to", weight: 0.4 },
    { id: "e-safe-2", sourceNodeId: "hub", targetNodeId: "safeNeighbor", type: "related_to", weight: 0.35 },
    // deg2Neighbor has degree 2 -> removing e-deg2 would drop it to 1 (< MIN_SAFE_DEGREE=2)
    { id: "e-deg2-a", sourceNodeId: "hub", targetNodeId: "deg2Neighbor", type: "related_to", weight: 0.4 },
    { id: "e-deg2-b", sourceNodeId: "deg2Neighbor", targetNodeId: "aux1", type: "imports", weight: 0.9 },
    // deg1Neighbor has degree 1 -> must NEVER be orphaned
    { id: "e-deg1", sourceNodeId: "hub", targetNodeId: "deg1Neighbor", type: "related_to", weight: 0.4 },
    // Extra edges so aux1, aux2, aux3 stay >= 2 and hub >= 6
    { id: "e-hub-aux1", sourceNodeId: "hub", targetNodeId: "aux1", type: "depends_on", weight: 0.85 },
    { id: "e-hub-aux2", sourceNodeId: "hub", targetNodeId: "aux2", type: "related_to", weight: 0.4 },
    { id: "e-aux2-aux3", sourceNodeId: "aux2", targetNodeId: "aux3", type: "uses", weight: 0.9 },
    { id: "e-hub-aux3", sourceNodeId: "hub", targetNodeId: "aux3", type: "related_to", weight: 0.4 },
    // weakOnlyHub has degree 4 (< 6) and NO strong edges -> its related_to edges should not qualify on weakOnlyHub alone,
    // wait: aux1/aux2/aux3 DO have strong edges, so test weakOnlyHub with two weak-only peers of degree 3
    { id: "e-weak-a", sourceNodeId: "weakOnlyHub", targetNodeId: "weakPeerA", type: "related_to", weight: 0.4 },
    { id: "e-weak-b", sourceNodeId: "weakOnlyHub", targetNodeId: "weakPeerB", type: "related_to", weight: 0.4 },
    { id: "e-weak-c", sourceNodeId: "weakOnlyHub", targetNodeId: "weakPeerC", type: "related_to", weight: 0.4 }
  ];

  // Add weakPeer nodes with deg=2 (only weak edges)
  nodes.push(
    { id: "weakPeerA", name: "WeakPeerA", type: "concept" },
    { id: "weakPeerB", name: "WeakPeerB", type: "concept" },
    { id: "weakPeerC", name: "WeakPeerC", type: "concept" }
  );
  edges.push(
    { id: "e-wp-ab", sourceNodeId: "weakPeerA", targetNodeId: "weakPeerB", type: "related_to", weight: 0.4 },
    { id: "e-wp-bc", sourceNodeId: "weakPeerB", targetNodeId: "weakPeerC", type: "related_to", weight: 0.4 },
    { id: "e-wp-ca", sourceNodeId: "weakPeerC", targetNodeId: "weakPeerA", type: "related_to", weight: 0.4 }
  );

  const engine = createMockEngine({ nodes, edges });
  const pageNodes = [nodes[0], nodes[1], nodes[2], nodes[3], nodes[7]];

  const result = await compactRedundantEdges(
    { engine, pageNodes },
    { dryRun: true, targetMaxReads: 10, limit: 50, minDegree: 1 } // minDegree: 1 should clamp to MIN_SAFE_DEGREE (2)
  );

  assert.equal(result.status, "dry_run");
  assert.equal(result.dryRun, true);
  assert.equal(result.minDegree, MIN_SAFE_DEGREE);
  assert.equal(result.compactedCount, 0);
  assert.equal(result.graveyardEntriesWritten, 0);

  // Zero KV mutations in dryRun mode
  assert.equal(engine.calls.kvSet.length, 0);
  assert.equal(engine.calls.kvDelete.length, 0);
  assert.equal(engine.calls.applyRetrievalRecord.length, 0);

  const plannedIds = new Set(result.plannedEdges.map((e) => e.edgeId));
  // Must NEVER compact strong edges, deg1 leaf edges, deg2 neighbor edges, or weak-only deg<6 clusters
  assert.equal(plannedIds.has("e-strong"), false);
  assert.equal(plannedIds.has("e-deg1"), false);
  assert.equal(plannedIds.has("e-deg2-a"), false);
  assert.equal(plannedIds.has("e-weak-a"), false);
  assert.equal(plannedIds.has("e-weak-b"), false);
  assert.equal(plannedIds.has("e-weak-c"), false);

  // At most one of e-safe-1 / e-safe-2 can be removed so safeNeighbor never falls below degree 2
  const safePairSelected = Number(plannedIds.has("e-safe-1")) + Number(plannedIds.has("e-safe-2"));
  assert.equal(safePairSelected, 1);

  // Verify global post-compaction degree invariant: no node that started >= 2 drops below 2, and deg1 stays 1
  const remainingEdges = edges.filter((e) => !plannedIds.has(e.id));
  const afterCost = estimateSubgraphReadCost(pageNodes, remainingEdges);
  assert.equal(afterCost.estimatedReads, result.estimatedReadsAfter);
  assert.ok(afterCost.estimatedReads < result.estimatedReadsBefore);
  for (const planned of result.plannedEdges) {
    assert.ok(planned.sourceDegAfter >= MIN_SAFE_DEGREE);
    assert.ok(planned.targetDegAfter >= MIN_SAFE_DEGREE);
  }
});

test("runBudgetSimulation and compactRedundantEdges (dryRun: false) work cleanly against mock KV and temp graveyard", async () => {
  const nodes = [
    { id: "h", name: "Hub", type: "project" },
    { id: "a", name: "NodeA", type: "file" },
    { id: "b", name: "NodeB", type: "file" },
    { id: "c", name: "NodeC", type: "file" }
  ];
  // Every node has degree >= 3 with a strong edge and a low-weight related_to edge
  const edges = [
    { id: "s1", sourceNodeId: "h", targetNodeId: "a", type: "imports", weight: 0.9 },
    { id: "s2", sourceNodeId: "h", targetNodeId: "b", type: "depends_on", weight: 0.9 },
    { id: "s3", sourceNodeId: "a", targetNodeId: "c", type: "uses", weight: 0.9 },
    { id: "s4", sourceNodeId: "b", targetNodeId: "c", type: "modifies", weight: 0.9 },
    { id: "w1", sourceNodeId: "h", targetNodeId: "a", type: "related_to", weight: 0.4 },
    { id: "w2", sourceNodeId: "h", targetNodeId: "b", type: "related_to", weight: 0.4 },
    { id: "w3", sourceNodeId: "h", targetNodeId: "c", type: "related_to", weight: 0.4 }
  ];

  const engine = createMockEngine({ nodes, edges });
  const sim = await runBudgetSimulation(
    {
      engine,
      queryGraph: async () => ({
        nodes,
        edges,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        truncated: true
      })
    },
    { targetMaxReads: 30, limit: 10 }
  );

  assert.equal(sim.status, "simulated");
  assert.equal(sim.truncated, true);
  assert.ok(sim.candidateCount >= 1);
  assert.ok(sim.candidates.every((c) => c.type === "related_to" && c.weight <= 0.45));

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agm-compactor-test-"));
  const graveyardPath = path.join(tmpDir, "graveyard.jsonl");
  let rebuilt = false;

  try {
    const compacted = await compactRedundantEdges(
      {
        engine,
        pageNodes: nodes,
        graveyardPath,
        rebuildSnapshot: async () => {
          rebuilt = true;
        }
      },
      { dryRun: false, targetMaxReads: 30, limit: 10, graveyardPath }
    );

    assert.equal(compacted.status, "compacted");
    assert.equal(compacted.dryRun, false);
    assert.equal(compacted.snapshotRebuilt, true);
    assert.equal(rebuilt, true);
    assert.ok(compacted.compactedCount >= 1);
    assert.equal(compacted.graveyardEntriesWritten, compacted.compactedCount);

    const lines = fs.readFileSync(graveyardPath, "utf8").trim().split("\n");
    assert.equal(lines.length, compacted.compactedCount);
    const firstRecord = JSON.parse(lines[0]);
    assert.equal(firstRecord.reason, "edge_compacted_budget");
    assert.equal(firstRecord.kind, "edge");
    assert.equal(engine.calls.applyRetrievalRecord.length, compacted.compactedCount);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
