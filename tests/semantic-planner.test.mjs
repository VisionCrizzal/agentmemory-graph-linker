import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MAX_NODE_ALIASES,
  MAX_NODE_SOURCE_OBS,
  PLANNER_VERSION,
  scoreSynonymPair,
  classifyAutoSafeMerge,
  findSemanticDuplicateCandidates,
  applySemanticMergePlan,
  buildSemanticLinkBatch,
  applyTemporalLinks,
  runApplyAndCompactCycle
} from "../skill/agentmemory-graph-linker/scripts/semantic-planner.mjs";

function createSemanticMockEngine({
  nodes = [],
  edges = [],
  facets = [],
  observationsBySession = {},
  control = { buildId: "b1", nodes: nodes.length, edges: edges.length }
} = {}) {
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
  store.set("mem:graph:edge-history", new Map());
  store.set("mem:graph:node-degree", new Map());
  store.set("mem:graph:name-index", new Map(nodes.map((n) => [`${n.type}|${n.name}`, n.id])));
  store.set("mem:graph:membership", new Map());
  store.set("mem:facets", new Map(facets.map((f) => [f.id, structuredClone(f)])));
  store.set("mem:graph:retrieval-control", new Map([["current", structuredClone(control)]]));

  const sessions = Object.keys(observationsBySession).map((sid) => ({ id: sid }));
  store.set("mem:sessions", new Map(sessions.map((s) => [s.id, s])));
  for (const [sid, obsList] of Object.entries(observationsBySession)) {
    store.set(`mem:obs:${sid}`, new Map(obsList.map((o) => [o.id, structuredClone(o)])));
  }

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
      const next = { ...(ctrl || {}) };
      if (kind === "node") {
        next.nodes = store.get("mem:graph:nodes")?.size ?? next.nodes ?? 0;
      } else if (kind === "edge") {
        next.edges = store.get("mem:graph:edges")?.size ?? next.edges ?? 0;
      }
      store.get("mem:graph:retrieval-control").set("current", structuredClone(next));
      return { next };
    }
  };
}

test("scoreSynonymPair handles Unicode hyphens, abbreviations, shared neighbors/obs, and caps disjoint file basenames", () => {
  const neighborsById = new Map([
    ["n1", new Set(["hub1", "hub2"])],
    ["n2", new Set(["hub1", "hub2"])],
    ["f1", new Set(["hub1", "hub2"])],
    ["f2", new Set(["hub1", "hub2"])]
  ]);

  const hyphenVariant = scoreSynonymPair(
    {
      id: "n1",
      type: "concept",
      name: "Smart\u2011AI\u2013Router",
      sourceObservationIds: ["obs_1", "obs_2"]
    },
    {
      id: "n2",
      type: "concept",
      name: "Smart AI Router",
      sourceObservationIds: ["obs_1", "obs_2"]
    },
    neighborsById
  );
  assert.ok(hyphenVariant.score >= 0.9, `expected >= 0.9, got ${hyphenVariant.score}`);
  assert.ok(hyphenVariant.reasons.includes("compact_match"));
  assert.deepEqual(hyphenVariant.sharedObs.sort(), ["obs_1", "obs_2"]);
  assert.deepEqual(hyphenVariant.sharedNeighbors.sort(), ["hub1", "hub2"]);

  const acronymMatch = scoreSynonymPair(
    { id: "a1", type: "concept", name: "Smart AI Router", sourceObservationIds: [] },
    { id: "a2", type: "concept", name: "SAR", sourceObservationIds: [] }
  );
  assert.ok(acronymMatch.score >= 0.45, `expected acronym score >= 0.45, got ${acronymMatch.score}`);
  assert.ok(acronymMatch.reasons.includes("abbreviation_match"));

  const disjointFiles = scoreSynonymPair(
    {
      id: "f1",
      type: "file",
      name: "/Users/dev/project/src/router.mjs",
      sourceObservationIds: ["obs_1", "obs_2"]
    },
    {
      id: "f2",
      type: "file",
      name: "/Users/dev/project/src/compactor.mjs",
      sourceObservationIds: ["obs_1", "obs_2"]
    },
    neighborsById
  );
  assert.ok(
    disjointFiles.score <= 0.35,
    `expected disjoint file basenames <= 0.35, got ${disjointFiles.score}`
  );
  assert.ok(disjointFiles.reasons.includes("disjoint_file_basenames_capped"));
});

test("findSemanticDuplicateCandidates scans mock engine, skips exact duplicates & scratch nodes, and ranks synonym pairs", async () => {
  const nodes = [
    {
      id: "gn_keep",
      type: "concept",
      name: "AgentMemory Graph Linker",
      sourceObservationIds: ["obs_1", "obs_2"]
    },
    {
      id: "gn_dup_abbrev",
      type: "concept",
      name: "AgentMemory Linker",
      sourceObservationIds: ["obs_1", "obs_2"]
    },
    // Exact duplicate (same type + normalized lowercase) must be skipped
    {
      id: "gn_exact_a",
      type: "tool",
      name: "node\u2011test",
      sourceObservationIds: ["obs_3"]
    },
    {
      id: "gn_exact_b",
      type: "tool",
      name: "node-test",
      sourceObservationIds: ["obs_3"]
    },
    // Transient scratch node must be skipped
    {
      id: "gn_scratch",
      type: "file",
      name: "/tmp/AgentMemory-Graph-Linker.txt",
      sourceObservationIds: ["obs_1"]
    },
    {
      id: "gn_hub",
      type: "project",
      name: "AgentMemory Core",
      sourceObservationIds: []
    }
  ];

  const edges = [
    { id: "ge_1", sourceNodeId: "gn_keep", targetNodeId: "gn_hub", type: "uses", isLatest: true },
    { id: "ge_2", sourceNodeId: "gn_dup_abbrev", targetNodeId: "gn_hub", type: "uses", isLatest: true }
  ];

  const engine = createSemanticMockEngine({ nodes, edges });
  const res = await findSemanticDuplicateCandidates({ engine }, { minScore: 0.45, limit: 20 });

  assert.equal(res.status, "candidates_ready");
  assert.equal(res.version, PLANNER_VERSION);
  // Scratch node excluded from scanned total
  assert.equal(res.totalNodesScanned, 5);
  assert.ok(res.candidateCount >= 1);

  const pairIds = res.candidates.map((c) => [c.nodeA.id, c.nodeB.id].sort().join(":"));
  assert.equal(pairIds.includes("gn_exact_a:gn_exact_b"), false);
  assert.equal(
    res.candidates.some(
      (c) =>
        [c.nodeA.id, c.nodeB.id].sort().join(":") === "gn_dup_abbrev:gn_keep" && c.score >= 0.45
    ),
    true
  );
  for (const c of res.candidates) {
    assert.ok(c.suggestedAliases.length <= MAX_NODE_ALIASES);
  }
});

test("applySemanticMergePlan supports dryRun and live mock KV merges preserving aliases <= 10 and sourceObservationIds <= 24", async () => {
  const keepExistingAliases = Array.from({ length: 8 }, (_, i) => `keep-alias-${i + 1}`);
  const mergeExistingAliases = Array.from({ length: 5 }, (_, i) => `merge-alias-${i + 1}`);
  const keepObs = Array.from({ length: 18 }, (_, i) => `obs_k_${i + 1}`);
  const mergeObs = Array.from({ length: 14 }, (_, i) => `obs_m_${i + 1}`);

  const nodes = [
    {
      id: "gn_keep",
      type: "concept",
      name: "Smart AI Router",
      aliases: keepExistingAliases,
      sourceObservationIds: keepObs,
      properties: { occurrences: 3 }
    },
    {
      id: "gn_merge",
      type: "concept",
      name: "Smart-Router-Proxy",
      aliases: mergeExistingAliases,
      sourceObservationIds: mergeObs,
      properties: { occurrences: 2 }
    },
    {
      id: "gn_peer",
      type: "file",
      name: "router/smart-router.mjs",
      sourceObservationIds: []
    },
    {
      id: "gn_other",
      type: "project",
      name: "AgentMemory",
      sourceObservationIds: []
    }
  ];

  const edges = [
    // Duplicate active edge already on keepNode -> should be deleted as redundant
    { id: "ge_keep_peer", sourceNodeId: "gn_keep", targetNodeId: "gn_peer", type: "uses", isLatest: true },
    { id: "ge_merge_peer_dup", sourceNodeId: "gn_merge", targetNodeId: "gn_peer", type: "uses", isLatest: true },
    // Self-loop between keep & merge -> should be deleted
    { id: "ge_self", sourceNodeId: "gn_keep", targetNodeId: "gn_merge", type: "related_to", isLatest: true },
    // Unique edge on mergeNode -> should be repointed to keepNode
    { id: "ge_merge_other", sourceNodeId: "gn_merge", targetNodeId: "gn_other", type: "modifies", isLatest: true }
  ];

  const facets = [{ id: "fc_1", targetId: "gn_merge", text: "proxy facet" }];
  const engine = createSemanticMockEngine({ nodes, edges, facets });

  // 1. Dry run must not mutate mock KV or write graveyard
  const dryRes = await applySemanticMergePlan(
    { engine },
    [{ keep: "gn_keep", merge: "gn_merge" }],
    { dryRun: true }
  );
  assert.equal(dryRes.status, "dry_run");
  assert.equal(dryRes.dryRun, true);
  assert.equal(dryRes.results[0].aliases.length, MAX_NODE_ALIASES);
  assert.equal(dryRes.results[0].sourceObservationIdsCount, MAX_NODE_SOURCE_OBS);
  assert.equal(dryRes.results[0].repointedEdgesCount, 1);
  assert.equal(dryRes.results[0].deletedRedundantEdgesCount, 2);
  assert.equal(engine.calls.kvSet.length, 0);
  assert.equal(engine.calls.kvDelete.length, 0);

  // 2. Mock KV live merge with temp graveyardPath
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agm-semantic-test-"));
  const graveyardPath = path.join(tmpDir, "graveyard.jsonl");

  try {
    let rebuilt = false;
    const liveRes = await applySemanticMergePlan(
      {
        engine,
        secret: "mock-secret",
        graveyardPath,
        rebuildSnapshot: async () => {
          rebuilt = true;
        }
      },
      [{ keep: "gn_keep", merge: "gn_merge" }],
      { graveyardPath }
    );

    assert.equal(liveRes.status, "semantic_merged");
    assert.equal(liveRes.mergedCount, 1);
    assert.equal(liveRes.repointedEdgesCount, 1);
    assert.equal(liveRes.deletedRedundantEdgesCount, 2);
    assert.equal(liveRes.graveyardEntriesWritten, 1);
    assert.equal(rebuilt, true);

    const updatedKeep = await engine.kvGet("mem:graph:nodes", "gn_keep");
    assert.ok(updatedKeep);
    assert.ok(updatedKeep.aliases.length <= MAX_NODE_ALIASES);
    assert.equal(updatedKeep.aliases.length, MAX_NODE_ALIASES);
    assert.ok(updatedKeep.aliases.includes("Smart-Router-Proxy"));
    assert.ok(updatedKeep.sourceObservationIds.length <= MAX_NODE_SOURCE_OBS);
    assert.equal(updatedKeep.sourceObservationIds.length, MAX_NODE_SOURCE_OBS);
    assert.equal(updatedKeep.properties.occurrences, 5);

    assert.equal(await engine.kvGet("mem:graph:nodes", "gn_merge"), null);
    assert.equal(await engine.kvGet("mem:facets", "fc_1"), null);
    assert.equal(await engine.kvGet("mem:graph:edges", "ge_self"), null);
    assert.equal(await engine.kvGet("mem:graph:edges", "ge_merge_peer_dup"), null);

    const repointedEdge = await engine.kvGet("mem:graph:edges", "ge_merge_other");
    assert.equal(repointedEdge.sourceNodeId, "gn_keep");
    assert.equal(repointedEdge.targetNodeId, "gn_other");

    const graveyardLines = fs.readFileSync(graveyardPath, "utf8").trim().split("\n");
    assert.equal(graveyardLines.length, 1);
    const archived = JSON.parse(graveyardLines[0]);
    assert.equal(archived.reason, "semantic_merged");
    assert.equal(archived.mergedIntoId, "gn_keep");
    assert.equal(archived.node.id, "gn_merge");
    assert.equal(archived.facets.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("buildSemanticLinkBatch gathers excerpts & hubs, and applyTemporalLinks validates and supersedes older edges", async () => {
  const nodes = [
    { id: "n_unlinked", type: "concept", name: "Task-Aware Model Tiering", sourceObservationIds: ["obs_t1"] },
    { id: "n_old", type: "concept", name: "gemini-2.5-flash", sourceObservationIds: [] },
    { id: "n_new", type: "concept", name: "gemini-3.1-flash-lite-preview", sourceObservationIds: [] },
    { id: "n_router", type: "pattern", name: "Smart AI Router", sourceObservationIds: [] }
  ];
  const edges = [
    {
      id: "ge_old_router",
      sourceNodeId: "n_router",
      targetNodeId: "n_old",
      type: "uses",
      weight: 0.9,
      version: 1,
      isLatest: true
    },
    {
      id: "ge_router_new_seed",
      sourceNodeId: "n_router",
      targetNodeId: "n_new",
      type: "related_to",
      weight: 0.4,
      version: 1,
      isLatest: true
    }
  ];
  const observationsBySession = {
    sess_1: [
      {
        id: "obs_t1",
        type: "decision",
        title: "Use fast vs accuracy tiering",
        narrative: "Route observation prompts to flash-lite and summaries to 3.8 flash.",
        concepts: ["Smart AI Router"],
        files: ["router/smart-router.mjs"],
        timestamp: "2026-11-12T10:00:00Z"
      }
    ]
  };

  const engine = createSemanticMockEngine({ nodes, edges, observationsBySession });
  const batch = await buildSemanticLinkBatch(
    {
      engine,
      queryGraph: async () => ({ nodes, edges })
    },
    { limit: 10 }
  );

  assert.equal(batch.status, "link_batch_ready");
  assert.equal(batch.unlinkedCount, 1);
  assert.equal(batch.observationsMatchedCount, 1);
  assert.equal(batch.items[0].id, "n_unlinked");
  assert.equal(batch.items[0].observationExcerpts.length, 1);
  assert.match(batch.items[0].observationExcerpts[0].excerpt, /flash-lite/);

  // Validation + temporal superseding in mock KV
  const res = await applyTemporalLinks(
    {
      engine,
      secret: "mock-secret",
      applyDirectXmlLinks: async () => ({ success: true, edgesAdded: 0, nodesAdded: 0 }),
      rebuildSnapshot: async () => {}
    },
    [
      // Invalid self-loop -> rejected
      { source: "Smart AI Router", target: "Smart AI Router", type: "uses" },
      // Valid temporal triple superseding ge_old_router
      {
        source: "Smart AI Router",
        sourceType: "pattern",
        target: "gemini-3.1-flash-lite-preview",
        targetType: "concept",
        type: "configures",
        weight: 0.95,
        tvalid: "2026-11-12T18:00:00Z",
        supersedes: "ge_old_router",
        reasoning: "Swapped dead gemini-2.5-flash to flash-lite-preview"
      }
    ]
  );

  assert.equal(res.status, "temporal_links_applied");
  assert.equal(res.rejectedCount, 1);
  assert.equal(res.rejected[0].reason, "self_loop_rejected");
  assert.equal(res.validCount, 1);
  assert.equal(res.supersededEdgesCount, 1);
  assert.deepEqual(res.supersededEdgeIds, ["ge_old_router"]);

  const superseded = await engine.kvGet("mem:graph:edges", "ge_old_router");
  assert.equal(superseded.isLatest, false);
  assert.equal(superseded.tvalidEnd, "2026-11-12T18:00:00.000Z");
  assert.ok(superseded.supersededBy);

  const hist = await engine.kvGet("mem:graph:edge-history", "ge_old_router");
  assert.equal(hist.isLatest, false);
});

test("findSemanticDuplicateCandidates clusters connected synonyms, builds autoSafePlan, and guards numeric versions", async () => {
  const nodes = [
    // Cluster 1: singular/plural + hyphen variant -> connected component of 3 nodes
    { id: "gn_1", type: "concept", name: "plugin script", sourceObservationIds: ["o1"] },
    { id: "gn_2", type: "concept", name: "plugin scripts", sourceObservationIds: ["o1"] },
    { id: "gn_3", type: "concept", name: "plugin-script runner", sourceObservationIds: ["o1"] },
    // Distinct numeric versions -> MUST NEVER be autoSafe
    { id: "gn_v15", type: "concept", name: "macOS 15", sourceObservationIds: ["o2"] },
    { id: "gn_v26", type: "concept", name: "macOS 26", sourceObservationIds: ["o2"] },
    // Hub giving gn_1 higher degree so it wins deterministically
    { id: "gn_hub", type: "project", name: "AgentMemory", sourceObservationIds: [] }
  ];
  const edges = [
    { id: "e_1h", sourceNodeId: "gn_1", targetNodeId: "gn_hub", type: "uses", isLatest: true }
  ];

  const engine = createSemanticMockEngine({ nodes, edges });
  const compactRes = await findSemanticDuplicateCandidates({ engine }, { minScore: 0.55, limit: 20 });

  assert.equal(compactRes.compact, true);
  assert.ok(compactRes.clusterCount >= 1);
  assert.ok(compactRes.autoSafeCount >= 1);
  assert.ok(
    compactRes.autoSafePlan.some((p) => p.keep === "gn_1" && p.merge === "gn_2"),
    "expected plural pair plugin scripts -> plugin script in autoSafePlan"
  );
  assert.equal(
    compactRes.autoSafePlan.some((p) => (p.keep === "gn_v15" && p.merge === "gn_v26") || (p.keep === "gn_v26" && p.merge === "gn_v15")),
    false,
    "numeric version pairs must never be autoSafe"
  );
  // Compact format omits raw sourceObservationIds arrays on candidates
  for (const cand of compactRes.candidates) {
    assert.equal("sourceObservationIds" in cand.nodeA, false);
    assert.equal("sourceObservationIds" in cand.nodeB, false);
  }

  // Full & clustersOnly flags work cleanly
  const fullRes = await findSemanticDuplicateCandidates(
    { engine },
    { minScore: 0.55, limit: 20, compact: false }
  );
  assert.equal("sourceObservationIds" in fullRes.candidates[0].nodeA, true);

  const clustersOnlyRes = await findSemanticDuplicateCandidates(
    { engine },
    { minScore: 0.55, limit: 20, clustersOnly: true }
  );
  assert.equal(clustersOnlyRes.candidates.length, 0);
  assert.ok(clustersOnlyRes.clusters.length >= 1);
  assert.ok(classifyAutoSafeMerge !== undefined);
});

test("buildSemanticLinkBatch separates trulyIsolated vs viewOnlyUnlinked, deduplicates hubCatalog, and surfaces compactable hubLeafGroups", async () => {
  const nodes = [
    { id: "n_hub", type: "file", name: "Info.plist", sourceObservationIds: ["o1"] },
    { id: "n_leaf_a", type: "concept", name: "Direct3D11 troubleshooting", sourceObservationIds: ["o1"] },
    { id: "n_leaf_b", type: "concept", name: "plist instrumentation", sourceObservationIds: ["o2"] },
    { id: "n_anchor_a", type: "concept", name: "DirectX debugging", sourceObservationIds: [] },
    { id: "n_anchor_b", type: "concept", name: "Wrapper plist audit", sourceObservationIds: [] },
    { id: "n_iso", type: "concept", name: "Truly isolated node", sourceObservationIds: ["o1"] },
    { id: "n_view_only", type: "concept", name: "View-only unlinked node", sourceObservationIds: [] },
    { id: "n_outside", type: "project", name: "Outside view peer", sourceObservationIds: [] }
  ];
  const edges = [
    // Hub (deg=3) has w=0.4 related_to edges to leafA and leafB (both deg=2)
    { id: "e_ha", sourceNodeId: "n_hub", targetNodeId: "n_leaf_a", type: "related_to", weight: 0.4, isLatest: true },
    { id: "e_hb", sourceNodeId: "n_hub", targetNodeId: "n_leaf_b", type: "related_to", weight: 0.4, isLatest: true },
    { id: "e_ho", sourceNodeId: "n_hub", targetNodeId: "n_outside", type: "uses", weight: 0.9, isLatest: true },
    { id: "e_aa", sourceNodeId: "n_anchor_a", targetNodeId: "n_leaf_a", type: "uses", weight: 0.9, isLatest: true },
    { id: "e_ab", sourceNodeId: "n_anchor_b", targetNodeId: "n_leaf_b", type: "uses", weight: 0.9, isLatest: true },
    // n_view_only has an edge ONLY outside viewNodes -> viewDegree=0 but globalDegree=1
    { id: "e_vo", sourceNodeId: "n_view_only", targetNodeId: "n_outside", type: "uses", weight: 0.9, isLatest: true }
  ];
  const viewNodes = nodes.filter((n) => n.id !== "n_outside");
  const viewEdges = edges.filter((e) => e.id !== "e_vo" && e.id !== "e_ho");
  const observationsBySession = {
    s1: [
      { id: "o1", title: "D3D11 check", narrative: "Check Direct3D11 DXVK plist env vars.", timestamp: "2026-11-15T10:00:00Z" },
      { id: "o2", title: "WINEDEBUG plist", narrative: "Inspect WINEDEBUG instrumentation in Info.plist.", timestamp: "2026-11-15T11:00:00Z" }
    ]
  };

  const engine = createSemanticMockEngine({ nodes, edges, observationsBySession });
  const batch = await buildSemanticLinkBatch(
    { engine, queryGraph: async () => ({ nodes: viewNodes, edges: viewEdges }) },
    { limit: 20, compact: true }
  );

  assert.equal(batch.version, PLANNER_VERSION);
  assert.equal(batch.compact, true);
  assert.equal(batch.trulyIsolatedCount, 1);
  assert.equal(batch.viewOnlyUnlinkedCount, 1);
  assert.ok(batch.hubCatalog && typeof batch.hubCatalog === "object");
  assert.equal(batch.items[0].id, "n_iso");
  assert.equal(batch.items[0].trulyIsolated, true);
  assert.ok(Array.isArray(batch.items[0].candidateHubIds));
  assert.equal("candidateHubs" in batch.items[0], false);

  const viewOnlyItem = batch.items.find((i) => i.id === "n_view_only");
  assert.equal(viewOnlyItem?.alreadyConnectedGlobally, true);
  assert.equal(viewOnlyItem?.globalDegree, 1);

  assert.ok(batch.hubLeafGroupCount >= 1);
  const plistGroup = batch.hubLeafGroups.find((g) => g.groupType === "shared_hub" && g.hub.id === "n_hub");
  assert.ok(plistGroup, "expected shared_hub group for Info.plist");
  assert.equal(plistGroup.expectedNetReadDeltaPerPair, -2);
  assert.deepEqual(plistGroup.leaves.map((l) => l.id).sort(), ["n_leaf_a", "n_leaf_b"]);

  // pairMode focuses only on trulyIsolated + hubLeafGroups
  const pairBatch = await buildSemanticLinkBatch(
    { engine, queryGraph: async () => ({ nodes: viewNodes, edges: viewEdges }) },
    { limit: 20, pairMode: true }
  );
  assert.equal(pairBatch.pairMode, true);
  assert.equal(pairBatch.items.length, 1);
  assert.equal(pairBatch.items[0].id, "n_iso");
  assert.ok(pairBatch.hubLeafGroups.length >= 1);
});

test("runApplyAndCompactCycle executes autoSafe merges, temporal links, edge compaction, single snapshot rebuild, and budget diff", async () => {
  const nodes = [
    { id: "n_hub", type: "file", name: "Info.plist", sourceObservationIds: [] },
    { id: "n_leaf_a", type: "concept", name: "Direct3D11 troubleshooting", sourceObservationIds: ["o1"] },
    { id: "n_leaf_b", type: "concept", name: "plist instrumentation", sourceObservationIds: ["o1"] },
    { id: "n_anchor_a", type: "concept", name: "DirectX debugging", sourceObservationIds: [] },
    { id: "n_anchor_b", type: "concept", name: "Wrapper audit", sourceObservationIds: [] },
    { id: "n_dup_s", type: "concept", name: "script runner", sourceObservationIds: ["o1"] },
    { id: "n_dup_p", type: "concept", name: "script runners", sourceObservationIds: ["o1"] }
  ];
  const edges = [
    { id: "e_ha", sourceNodeId: "n_hub", targetNodeId: "n_leaf_a", type: "related_to", weight: 0.4, isLatest: true },
    { id: "e_hb", sourceNodeId: "n_hub", targetNodeId: "n_leaf_b", type: "related_to", weight: 0.4, isLatest: true },
    { id: "e_ho", sourceNodeId: "n_hub", targetNodeId: "n_anchor_a", type: "uses", weight: 0.9, isLatest: true },
    { id: "e_ho2", sourceNodeId: "n_hub", targetNodeId: "n_anchor_b", type: "uses", weight: 0.9, isLatest: true },
    { id: "e_aa", sourceNodeId: "n_anchor_a", targetNodeId: "n_leaf_a", type: "uses", weight: 0.9, isLatest: true },
    { id: "e_ab", sourceNodeId: "n_anchor_b", targetNodeId: "n_leaf_b", type: "uses", weight: 0.9, isLatest: true },
    { id: "e_d1", sourceNodeId: "n_dup_s", targetNodeId: "n_anchor_b", type: "uses", weight: 0.9, isLatest: true },
    { id: "e_d2", sourceNodeId: "n_dup_p", targetNodeId: "n_anchor_b", type: "uses", weight: 0.9, isLatest: true }
  ];

  const engine = createSemanticMockEngine({ nodes, edges });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agm-cycle-test-"));
  const graveyardPath = path.join(tmpDir, "graveyard.jsonl");
  let rebuildCount = 0;

  try {
    const queryFn = async () => {
      const liveNodes = await engine.kvList("mem:graph:nodes");
      const liveEdges = await engine.kvList("mem:graph:edges");
      return { nodes: liveNodes, edges: liveEdges, totalNodes: liveNodes.length, totalEdges: liveEdges.length, truncated: false };
    };

    // Dry run should mutate nothing
    const dryCycle = await runApplyAndCompactCycle(
      {
        engine,
        secret: "mock-secret",
        graveyardPath,
        queryGraph: queryFn,
        applyDirectXmlLinks: async () => ({ success: true, edgesAdded: 0, nodesAdded: 0 }),
        rebuildSnapshot: async () => {
          rebuildCount += 1;
        }
      },
      {
        dryRun: true,
        autoSafeMerges: true,
        targetMaxReads: 1,
        links: [{ source: "n_leaf_a", target: "n_leaf_b", type: "uses", weight: 0.9 }]
      }
    );
    assert.equal(dryCycle.status, "dry_run");
    assert.equal(rebuildCount, 0);
    assert.equal(dryCycle.merges.autoSafeCandidateCount, 1);

    // Live cycle: auto-safe merge + leaf link -> immediate compaction of both hub weak edges + 1 snapshot rebuild
    const liveCycle = await runApplyAndCompactCycle(
      {
        engine,
        secret: "mock-secret",
        graveyardPath,
        queryGraph: queryFn,
        applyDirectXmlLinks: async () => ({ success: true, edgesAdded: 0, nodesAdded: 0 }),
        rebuildSnapshot: async () => {
          rebuildCount += 1;
        }
      },
      {
        dryRun: false,
        autoSafeMerges: true,
        targetMaxReads: 1,
        links: [{ source: "n_leaf_a", target: "n_leaf_b", type: "uses", weight: 0.9 }],
        runVerifyFn: async () => ({ status: "verified" })
      }
    );

    assert.equal(liveCycle.status, "cycle_completed");
    assert.equal(rebuildCount, 1, "snapshot must be rebuilt once per cycle");
    assert.equal(liveCycle.merges.mergedCount, 1);
    assert.equal(liveCycle.links.appliedEdgesCount, 1);
    assert.equal(liveCycle.compaction.compactedCount, 2);
    assert.ok(liveCycle.budget.readsDelta < 0, `expected negative readsDelta, got ${liveCycle.budget.readsDelta}`);
    assert.equal(liveCycle.verification.status, "verified");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
