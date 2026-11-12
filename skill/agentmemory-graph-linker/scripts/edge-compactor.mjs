/**
 * AgentMemory Graph Read-Budget Simulator & Redundant Edge Compactor (v4.0)
 *
 * Pure and async helpers to model the AgentMemory GraphIndexReader 4096-read
 * budget, surface safe-to-compact low-weight heuristic (`related_to`) edges,
 * and archive/remove redundant edges across all 5 synchronized KV layers plus
 * the Cold Graveyard (`~/.agentmemory/graveyard.jsonl`).
 *
 * Zero side effects on import.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const MAX_GRAPH_READS = 4096;
export const DEFAULT_TARGET_MAX_READS = 3800;
export const DEFAULT_COMPACTION_LIMIT = 250;
export const DEFAULT_QUERY_LIMIT = 500;
export const MIN_SAFE_DEGREE = 2;
export const MAX_HEURISTIC_WEIGHT = 0.45;
export const DEFAULT_HOT_HUBS_LIMIT = 20;

export const STRONG_SEMANTIC_EDGE_TYPES = new Set([
  "fixes",
  "depends_on",
  "imports",
  "modifies",
  "uses"
]);

function getDefaultGraveyardPath() {
  const dataDir =
    process.env.AGENTMEMORY_DATA_DIR || path.join(os.homedir(), ".agentmemory");
  return path.join(dataDir, "graveyard.jsonl");
}

function getEdgeWeight(edge) {
  if (!edge || edge.weight === undefined || edge.weight === null) return 0.4;
  const w = Number(edge.weight);
  return Number.isFinite(w) ? w : 0.4;
}

/**
 * Returns true if an edge represents a strong semantic relationship
 * (by canonical type or high weight >= 0.8).
 */
export function isStrongSemanticEdge(edge) {
  if (!edge || edge.stale || edge.isLatest === false) return false;
  if (STRONG_SEMANTIC_EDGE_TYPES.has(edge.type)) return true;
  if (edge.weight === undefined || edge.weight === null) return false;
  const weight = Number(edge.weight);
  return Number.isFinite(weight) && weight >= 0.8;
}

/**
 * Returns true if an edge is a low-weight heuristic `related_to` edge
 * eligible for read-budget compaction consideration.
 */
export function isLowWeightHeuristicEdge(edge) {
  if (!edge || edge.stale || edge.isLatest === false) return false;
  if (edge.type !== "related_to") return false;
  const weight = getEdgeWeight(edge);
  return Number.isFinite(weight) && weight <= MAX_HEURISTIC_WEIGHT;
}

function buildDegreeAndStrengthStats(allEdges = []) {
  const liveEdges = [];
  const activeEdges = [];
  const degMap = new Map();
  const strongCountMap = new Map();
  const relatedCountMap = new Map();
  const lowWeightCountMap = new Map();

  for (const edge of allEdges || []) {
    if (!edge || !edge.id || edge.stale) continue;
    if (!edge.sourceNodeId || !edge.targetNodeId) continue;
    liveEdges.push(edge);

    // Match AgentMemory mem::graph-snapshot-rebuild & GraphIndexReader adjacency accounting
    degMap.set(edge.sourceNodeId, (degMap.get(edge.sourceNodeId) || 0) + 1);
    degMap.set(edge.targetNodeId, (degMap.get(edge.targetNodeId) || 0) + 1);

    if (edge.isLatest === false) continue;
    activeEdges.push(edge);

    const endpoints =
      edge.sourceNodeId === edge.targetNodeId
        ? [edge.sourceNodeId]
        : [edge.sourceNodeId, edge.targetNodeId];

    if (isStrongSemanticEdge(edge)) {
      for (const nid of endpoints) {
        strongCountMap.set(nid, (strongCountMap.get(nid) || 0) + 1);
      }
    }
    if (edge.type === "related_to") {
      for (const nid of endpoints) {
        relatedCountMap.set(nid, (relatedCountMap.get(nid) || 0) + 1);
      }
    }
    if (isLowWeightHeuristicEdge(edge)) {
      for (const nid of endpoints) {
        lowWeightCountMap.set(nid, (lowWeightCountMap.get(nid) || 0) + 1);
      }
    }
  }

  return {
    liveEdges,
    activeEdges,
    degMap,
    strongCountMap,
    relatedCountMap,
    lowWeightCountMap
  };
}

function dedupePageNodes(pageNodes = []) {
  const seen = new Set();
  const unique = [];
  for (const node of pageNodes || []) {
    if (!node || !node.id || node.stale || seen.has(node.id)) continue;
    seen.add(node.id);
    unique.push(node);
  }
  return unique;
}

/**
 * Pure helper estimating the KV reads consumed by `POST /agentmemory/graph/query`
 * for `pageNodes` given all edges in the graph:
 *   2 (status + generation) + pageNodes.length (getNode) + 1 (nodes posting root)
 *   + pageNodes.length (nodes posting entries) + sum(1 + 2 * globalDeg)
 */
export function estimateSubgraphReadCost(pageNodes = [], allEdges = [], options = {}) {
  const maxReads =
    Number.isFinite(Number(options.maxReads)) && Number(options.maxReads) > 0
      ? Number(options.maxReads)
      : MAX_GRAPH_READS;
  const hotHubsLimit =
    Number.isFinite(Number(options.hotHubsLimit)) && Number(options.hotHubsLimit) >= 0
      ? Math.floor(Number(options.hotHubsLimit))
      : DEFAULT_HOT_HUBS_LIMIT;

  const nodes = dedupePageNodes(pageNodes);
  const { degMap, strongCountMap, relatedCountMap, lowWeightCountMap } =
    buildDegreeAndStrengthStats(allEdges);

  let totalGlobalDegree = 0;
  let adjacencyReads = 0;
  const hubEntries = [];

  for (const node of nodes) {
    const globalDeg = degMap.get(node.id) || 0;
    const nodeAdjacencyReads = 1 + 2 * globalDeg;
    totalGlobalDegree += globalDeg;
    adjacencyReads += nodeAdjacencyReads;

    if (globalDeg > 0) {
      hubEntries.push({
        id: node.id,
        name: node.name ?? "",
        type: node.type ?? "concept",
        globalDeg,
        estimatedReads: nodeAdjacencyReads,
        relatedToCount: relatedCountMap.get(node.id) || 0,
        lowWeightHeuristicCount: lowWeightCountMap.get(node.id) || 0,
        strongEdgeCount: strongCountMap.get(node.id) || 0
      });
    }
  }

  hubEntries.sort(
    (a, b) =>
      b.globalDeg - a.globalDeg ||
      b.lowWeightHeuristicCount - a.lowWeightHeuristicCount ||
      String(a.id).localeCompare(String(b.id))
  );

  const estimatedReads =
    2 + nodes.length + 1 + nodes.length + adjacencyReads;
  const wouldTruncate = estimatedReads > maxReads;

  return {
    estimatedReads,
    maxReads,
    wouldTruncate,
    headroomReads: maxReads - estimatedReads,
    pageNodeCount: nodes.length,
    totalGlobalDegree,
    adjacencyReads,
    hotHubs: hubEntries.slice(0, hotHubsLimit)
  };
}

function selectLifoPageNodes(allNodes, queryLimit) {
  const hasTimestamps = allNodes.some(
    (n) => typeof n.createdAt === "string" && Number.isFinite(Date.parse(n.createdAt))
  );
  if (!hasTimestamps) {
    return allNodes.slice(0, queryLimit);
  }
  return [...allNodes]
    .sort((a, b) => {
      const ta = Date.parse(a.createdAt || "") || 0;
      const tb = Date.parse(b.createdAt || "") || 0;
      return tb - ta;
    })
    .slice(0, queryLimit);
}

async function resolveGraphInputs(deps = {}, options = {}) {
  const queryLimit = Math.max(
    1,
    Math.min(
      Number.isFinite(Number(options.queryLimit))
        ? Math.floor(Number(options.queryLimit))
        : DEFAULT_QUERY_LIMIT,
      500
    )
  );
  const engine = deps?.engine;

  const preNodes = options.allNodes ?? deps?.allNodes;
  const preEdges = options.allEdges ?? deps?.allEdges;

  if (!engine && (!Array.isArray(preNodes) || !Array.isArray(preEdges))) {
    throw new Error(
      "deps.engine (with kvList/kvGet/kvSet/kvDelete/applyRetrievalRecord) is required"
    );
  }

  const [rawNodes, rawEdges] = await Promise.all([
    Array.isArray(preNodes) ? preNodes : engine.kvList("mem:graph:nodes"),
    Array.isArray(preEdges) ? preEdges : engine.kvList("mem:graph:edges")
  ]);

  const allNodes = (rawNodes || []).filter((n) => n && n.id && !n.stale);
  const allEdges = (rawEdges || []).filter((e) => e && e.id && !e.stale);
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  let pageNodes = Array.isArray(options.pageNodes ?? deps?.pageNodes)
    ? dedupePageNodes(options.pageNodes ?? deps?.pageNodes)
    : null;
  let pageEdgesCount = null;
  let totalStoreNodes = allNodes.length;
  let totalStoreEdges = allEdges.length;
  let liveTruncated = null;
  let liveQueryAvailable = false;
  let liveWarning = null;

  if (!pageNodes) {
    let queryPayload = null;
    if (typeof deps?.queryGraph === "function") {
      const res = await deps.queryGraph(deps.secret, queryLimit);
      queryPayload = res?.data && Array.isArray(res?.nodes) ? res.data : res;
      if (res && Array.isArray(res.nodes) && !queryPayload.nodes) {
        queryPayload = { ...queryPayload, nodes: res.nodes, edges: res.edges || [] };
      }
    } else if (deps?.baseUrl || deps?.fetch || options.fetch) {
      const fetchImpl = deps?.fetch || options.fetch || globalThis.fetch;
      if (typeof fetchImpl === "function" && deps?.baseUrl) {
        const cleanBase = String(deps.baseUrl).replace(/\/+$/, "");
        const headers = { "Content-Type": "application/json" };
        if (deps.secret) headers.Authorization = `Bearer ${deps.secret}`;
        try {
          const res = await fetchImpl(`${cleanBase}/agentmemory/graph/query`, {
            method: "POST",
            headers,
            body: JSON.stringify({ limit: queryLimit })
          });
          if (res && res.ok) {
            queryPayload = await res.json();
          }
        } catch {
          // Offline / test environment fallback handled below
        }
      }
    }

    if (queryPayload && Array.isArray(queryPayload.nodes)) {
      pageNodes = dedupePageNodes(queryPayload.nodes);
      pageEdgesCount = Array.isArray(queryPayload.edges)
        ? queryPayload.edges.length
        : null;
      if (typeof queryPayload.totalNodes === "number") {
        totalStoreNodes = queryPayload.totalNodes;
      }
      if (typeof queryPayload.totalEdges === "number") {
        totalStoreEdges = queryPayload.totalEdges;
      }
      if (typeof queryPayload.truncated === "boolean") {
        liveTruncated = queryPayload.truncated;
      }
      liveWarning = queryPayload.warning ?? null;
      liveQueryAvailable = true;
    } else {
      pageNodes = dedupePageNodes(selectLifoPageNodes(allNodes, queryLimit));
    }
  }

  if (pageEdgesCount === null) {
    const pageIdSet = new Set(pageNodes.map((n) => n.id));
    pageEdgesCount = allEdges.filter(
      (e) =>
        e.isLatest !== false &&
        pageIdSet.has(e.sourceNodeId) &&
        pageIdSet.has(e.targetNodeId)
    ).length;
  }

  return {
    queryLimit,
    pageNodes,
    pageEdgesCount,
    totalStoreNodes,
    totalStoreEdges,
    liveTruncated,
    liveQueryAvailable,
    liveWarning,
    allNodes,
    allEdges,
    nodeById
  };
}

function canSafelyCompactEdge(edge, workingDeg, strongCountMap, minDegree) {
  const u = edge.sourceNodeId;
  const v = edge.targetNodeId;
  const degU = workingDeg.get(u) || 0;
  const degV = workingDeg.get(v) || 0;

  if (u === v) {
    if (degU - 2 < minDegree) return false;
  } else {
    if (degU - 1 < minDegree || degV - 1 < minDegree) return false;
  }

  const strongU = strongCountMap.get(u) || 0;
  const strongV = strongCountMap.get(v) || 0;
  return strongU > 0 || strongV > 0 || degU >= 6 || degV >= 6;
}

function buildCompactionReason(edge, degU, degV, afterU, afterV, strongU, strongV, readSavings, minDegree) {
  const weight = getEdgeWeight(edge);
  const evidence = [];
  if (strongU > 0 || strongV > 0) {
    evidence.push(`stronger semantic edges present (src=${strongU}, dst=${strongV})`);
  }
  if (degU >= 6 || degV >= 6) {
    evidence.push(`hub degree >= 6 (src=${degU}, dst=${degV})`);
  }
  return (
    `low-weight heuristic related_to (weight=${weight.toFixed(2)}) incident to pageNodes hub; ` +
    `${evidence.join(" & ")}; endpoints stay >= ${minDegree} (${degU}->${afterU}, ${degV}->${afterV}); ` +
    `saves ${readSavings} KV reads`
  );
}

function planSafeEdgeCompactions({
  pageNodes,
  allEdges,
  nodeById,
  maxReads = MAX_GRAPH_READS,
  targetMaxReads = DEFAULT_TARGET_MAX_READS,
  limit = DEFAULT_COMPACTION_LIMIT,
  minDegree = MIN_SAFE_DEGREE,
  hotHubsLimit = DEFAULT_HOT_HUBS_LIMIT,
  stopAtTarget = true
}) {
  const safeMinDegree = Math.max(MIN_SAFE_DEGREE, Math.floor(Number(minDegree) || MIN_SAFE_DEGREE));
  const beforeCost = estimateSubgraphReadCost(pageNodes, allEdges, {
    maxReads,
    hotHubsLimit
  });
  const stats = buildDegreeAndStrengthStats(allEdges);
  const pageNodeIds = new Set(dedupePageNodes(pageNodes).map((n) => n.id));

  const rawEligible = [];
  let outOfViewUpperSavings = 0;

  for (const edge of stats.activeEdges) {
    if (!isLowWeightHeuristicEdge(edge)) continue;
    const inSrc = pageNodeIds.has(edge.sourceNodeId);
    const inDst = pageNodeIds.has(edge.targetNodeId);
    if (!inSrc && !inDst) continue;

    if (!canSafelyCompactEdge(edge, stats.degMap, stats.strongCountMap, safeMinDegree)) {
      continue;
    }

    const sameEndpoint = edge.sourceNodeId === edge.targetNodeId;
    const inPageEndpoints = sameEndpoint ? 1 : Number(inSrc) + Number(inDst);
    const readSavings = 2 * inPageEndpoints;
    const degU = stats.degMap.get(edge.sourceNodeId) || 0;
    const degV = stats.degMap.get(edge.targetNodeId) || 0;
    const hubPageDeg = sameEndpoint
      ? degU
      : Math.max(inSrc ? degU : 0, inDst ? degV : 0);
    const weight = getEdgeWeight(edge);
    const createdAtMs =
      typeof edge.createdAt === "string" && Number.isFinite(Date.parse(edge.createdAt))
        ? Date.parse(edge.createdAt)
        : 0;

    if (inPageEndpoints === 1) {
      outOfViewUpperSavings += 2;
    }

    rawEligible.push({
      edge,
      inPageEndpoints,
      readSavings,
      hubPageDeg,
      weight,
      createdAtMs
    });
  }

  const neededReads = Math.max(0, beforeCost.estimatedReads - targetMaxReads);
  const preferHighSavings =
    stopAtTarget && neededReads > 0 && (limit <= 0 || outOfViewUpperSavings < neededReads || neededReads > limit * 2);

  rawEligible.sort((a, b) => {
    if (preferHighSavings) {
      if (b.readSavings !== a.readSavings) return b.readSavings - a.readSavings;
    } else if (a.inPageEndpoints !== b.inPageEndpoints) {
      // Prefer invisible out-of-view legacy edges first to preserve visible top-500 graph edges
      return a.inPageEndpoints - b.inPageEndpoints;
    }
    if (b.hubPageDeg !== a.hubPageDeg) return b.hubPageDeg - a.hubPageDeg;
    if (a.weight !== b.weight) return a.weight - b.weight;
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
    return String(a.edge.id).localeCompare(String(b.edge.id));
  });

  const workingDeg = new Map(stats.degMap);
  const selected = [];
  const selectedIds = new Set();
  let projectedReads = beforeCost.estimatedReads;

  for (const cand of rawEligible) {
    if (selected.length >= limit) break;
    if (stopAtTarget && projectedReads <= targetMaxReads) break;

    const edge = cand.edge;
    if (!canSafelyCompactEdge(edge, workingDeg, stats.strongCountMap, safeMinDegree)) {
      continue;
    }

    const u = edge.sourceNodeId;
    const v = edge.targetNodeId;
    const sameEndpoint = u === v;
    const degU = workingDeg.get(u) || 0;
    const degV = workingDeg.get(v) || 0;
    const afterU = sameEndpoint ? degU - 2 : degU - 1;
    const afterV = sameEndpoint ? degV - 2 : degV - 1;
    const strongU = stats.strongCountMap.get(u) || 0;
    const strongV = stats.strongCountMap.get(v) || 0;
    const sourceNode = nodeById.get(u);
    const targetNode = nodeById.get(v);

    if (sameEndpoint) {
      workingDeg.set(u, afterU);
    } else {
      workingDeg.set(u, afterU);
      workingDeg.set(v, afterV);
    }

    projectedReads -= cand.readSavings;
    selectedIds.add(edge.id);

    selected.push({
      edge,
      edgeId: edge.id,
      id: edge.id,
      type: edge.type,
      weight: cand.weight,
      sourceNodeId: u,
      sourceName: sourceNode?.name ?? "",
      sourceType: sourceNode?.type ?? "",
      sourceDegBefore: degU,
      sourceDegAfter: afterU,
      targetNodeId: v,
      targetName: targetNode?.name ?? "",
      targetType: targetNode?.type ?? "",
      targetDegBefore: degV,
      targetDegAfter: afterV,
      inPageEndpoints: cand.inPageEndpoints,
      readSavings: cand.readSavings,
      reason: buildCompactionReason(
        edge,
        degU,
        degV,
        afterU,
        afterV,
        strongU,
        strongV,
        cand.readSavings,
        safeMinDegree
      )
    });
  }

  const remainingEdges = allEdges.filter((e) => e && !selectedIds.has(e.id));
  const afterCost = estimateSubgraphReadCost(pageNodes, remainingEdges, {
    maxReads,
    hotHubsLimit
  });

  return {
    beforeCost,
    afterCost,
    selected,
    selectedIds,
    remainingEdges,
    minDegree: safeMinDegree,
    totalEligibleBeforeGreedy: rawEligible.length
  };
}

function appendEdgeCompactionGraveyard(graveyardPath, items, nodeById) {
  if (!items || !items.length) return 0;
  const archivedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(graveyardPath), { recursive: true });
  const lines =
    items
      .map((item) => {
        const src = nodeById.get(item.sourceNodeId);
        const dst = nodeById.get(item.targetNodeId);
        return JSON.stringify({
          archivedAt,
          reason: "edge_compacted_budget",
          kind: "edge",
          edge: item.edge,
          sourceNode: src
            ? { id: src.id, type: src.type, name: src.name }
            : { id: item.sourceNodeId },
          targetNode: dst
            ? { id: dst.id, type: dst.type, name: dst.name }
            : { id: item.targetNodeId },
          readSavings: item.readSavings,
          compactionReason: item.reason
        });
      })
      .join("\n") + "\n";
  fs.appendFileSync(graveyardPath, lines, "utf8");
  return items.length;
}

async function triggerSnapshotRebuild(deps, options = {}) {
  if (typeof deps?.rebuildSnapshot === "function") {
    await deps.rebuildSnapshot(deps.secret);
    return true;
  }
  if (typeof deps?.engine?.worker?.trigger === "function") {
    const namespace =
      deps.namespace ||
      options.namespace ||
      process.env.AGENTMEMORY_NAMESPACE ||
      "agentmemory-3111";
    await deps.engine.worker.trigger({
      namespace,
      function_id: "mem::graph-snapshot-rebuild",
      payload: { force: true }
    });
    return true;
  }
  const fetchImpl = deps?.fetch || options.fetch || globalThis.fetch;
  if (typeof fetchImpl === "function" && deps?.baseUrl) {
    const cleanBase = String(deps.baseUrl).replace(/\/+$/, "");
    const headers = { "Content-Type": "application/json" };
    if (deps.secret) headers.Authorization = `Bearer ${deps.secret}`;
    const res = await fetchImpl(`${cleanBase}/agentmemory/graph/snapshot-rebuild`, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });
    return Boolean(res?.ok);
  }
  return false;
}

/**
 * Simulates the top-N GraphIndexReader read budget against live query results and KV edges,
 * returning live `truncated` status, `estimateSubgraphReadCost`, and safe-to-compact
 * low-weight `related_to` (`weight <= 0.45`) candidates with reasons.
 */
export async function runBudgetSimulation(deps = {}, options = {}) {
  const maxReads =
    Number.isFinite(Number(options.maxReads)) && Number(options.maxReads) > 0
      ? Number(options.maxReads)
      : MAX_GRAPH_READS;
  const targetMaxReads = Number.isFinite(Number(options.targetMaxReads))
    ? Math.max(0, Number(options.targetMaxReads))
    : DEFAULT_TARGET_MAX_READS;
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(0, Math.floor(Number(options.limit)))
    : DEFAULT_COMPACTION_LIMIT;
  const minDegree = Math.max(
    MIN_SAFE_DEGREE,
    Number.isFinite(Number(options.minDegree))
      ? Math.floor(Number(options.minDegree))
      : MIN_SAFE_DEGREE
  );

  const inputs = await resolveGraphInputs(deps, options);
  const plan = planSafeEdgeCompactions({
    pageNodes: inputs.pageNodes,
    allEdges: inputs.allEdges,
    nodeById: inputs.nodeById,
    maxReads,
    targetMaxReads,
    limit,
    minDegree,
    hotHubsLimit: options.hotHubsLimit,
    stopAtTarget: false
  });

  // Also calculate exact target-driven read count if compacted down to targetMaxReads
  let readsAtTarget = plan.beforeCost.estimatedReads;
  let edgesNeededForTarget = 0;
  for (const cand of plan.selected) {
    if (readsAtTarget <= targetMaxReads) break;
    readsAtTarget -= cand.readSavings;
    edgesNeededForTarget += 1;
  }

  const candidates = plan.selected.map(({ edge: _edge, ...rest }) => rest);
  const truncated =
    inputs.liveTruncated !== null ? inputs.liveTruncated : plan.beforeCost.wouldTruncate;

  return {
    status: "simulated",
    queryLimit: inputs.queryLimit,
    liveQueryAvailable: inputs.liveQueryAvailable,
    truncated,
    liveTruncated: inputs.liveTruncated,
    liveWarning: inputs.liveWarning,
    totalStoreNodes: inputs.totalStoreNodes,
    totalStoreEdges: inputs.totalStoreEdges,
    pageNodesCount: inputs.pageNodes.length,
    pageEdgesCount: inputs.pageEdgesCount,
    ...plan.beforeCost,
    estimateSubgraphReadCost: plan.beforeCost,
    targetMaxReads,
    edgesNeededForTarget,
    estimatedReadsAtTarget: readsAtTarget,
    estimatedReadsAfterCompaction: plan.afterCost.estimatedReads,
    wouldTruncateAfterCompaction: plan.afterCost.wouldTruncate,
    estimatedReadsSaved:
      plan.beforeCost.estimatedReads - plan.afterCost.estimatedReads,
    candidateCount: candidates.length,
    candidates
  };
}

/**
 * Safely compacts redundant low-weight heuristic (`related_to`, `weight <= 0.45`) edges
 * incident to high-degree `pageNodes` hubs without reducing any node below `minDegree >= 2`.
 *
 * - `dryRun: true` (default): returns exact compaction plan with zero KV or disk writes.
 * - `dryRun: false`: archives removed edges to `graveyardPath` (`reason: "edge_compacted_budget"`),
 *   unlinks via `engine.applyRetrievalRecord`, deletes from `mem:graph:edges`, `mem:graph:edge-key`,
 *   `mem:graph:edge-history`, updates `mem:graph:node-degree` and `mem:graph:retrieval-control`,
 *   and triggers snapshot rebuild.
 */
export async function compactRedundantEdges(
  deps = {},
  options = {
    dryRun: true,
    targetMaxReads: DEFAULT_TARGET_MAX_READS,
    limit: DEFAULT_COMPACTION_LIMIT
  }
) {
  const dryRun = options?.dryRun !== false;
  const maxReads =
    Number.isFinite(Number(options?.maxReads)) && Number(options?.maxReads) > 0
      ? Number(options.maxReads)
      : MAX_GRAPH_READS;
  const targetMaxReads = Number.isFinite(Number(options?.targetMaxReads))
    ? Math.max(0, Number(options.targetMaxReads))
    : DEFAULT_TARGET_MAX_READS;
  const limit = Number.isFinite(Number(options?.limit))
    ? Math.max(0, Math.floor(Number(options.limit)))
    : DEFAULT_COMPACTION_LIMIT;
  const minDegree = Math.max(
    MIN_SAFE_DEGREE,
    Number.isFinite(Number(options?.minDegree))
      ? Math.floor(Number(options.minDegree))
      : MIN_SAFE_DEGREE
  );
  const graveyardPath =
    options?.graveyardPath || deps?.graveyardPath || getDefaultGraveyardPath();

  const inputs = await resolveGraphInputs(deps, options);
  const plan = planSafeEdgeCompactions({
    pageNodes: inputs.pageNodes,
    allEdges: inputs.allEdges,
    nodeById: inputs.nodeById,
    maxReads,
    targetMaxReads,
    limit,
    minDegree,
    hotHubsLimit: options?.hotHubsLimit,
    stopAtTarget: true
  });

  const plannedDescriptors = plan.selected.map(({ edge: _edge, ...rest }) => rest);
  const affectedNodeIds = new Set();
  for (const item of plan.selected) {
    affectedNodeIds.add(item.sourceNodeId);
    affectedNodeIds.add(item.targetNodeId);
  }

  const alreadyWithinBudget = plan.beforeCost.estimatedReads <= targetMaxReads;

  if (dryRun) {
    return {
      status: "dry_run",
      dryRun: true,
      targetMaxReads,
      limit,
      minDegree,
      alreadyWithinBudget,
      estimatedReadsBefore: plan.beforeCost.estimatedReads,
      estimatedReadsAfter: plan.afterCost.estimatedReads,
      estimatedReadsSaved:
        plan.beforeCost.estimatedReads - plan.afterCost.estimatedReads,
      wouldTruncateBefore: plan.beforeCost.wouldTruncate,
      wouldTruncateAfter: plan.afterCost.wouldTruncate,
      liveTruncatedBefore: inputs.liveTruncated,
      selectedCount: plannedDescriptors.length,
      compactedCount: 0,
      graveyardEntriesWritten: 0,
      graveyardFile: graveyardPath,
      affectedNodeCount: affectedNodeIds.size,
      plannedEdges: plannedDescriptors,
      hotHubsBefore: plan.beforeCost.hotHubs,
      hotHubsAfter: plan.afterCost.hotHubs
    };
  }

  if (plan.selected.length === 0) {
    return {
      status: "nothing_to_compact",
      dryRun: false,
      targetMaxReads,
      limit,
      minDegree,
      alreadyWithinBudget,
      estimatedReadsBefore: plan.beforeCost.estimatedReads,
      estimatedReadsAfter: plan.beforeCost.estimatedReads,
      estimatedReadsSaved: 0,
      wouldTruncateBefore: plan.beforeCost.wouldTruncate,
      wouldTruncateAfter: plan.beforeCost.wouldTruncate,
      liveTruncatedBefore: inputs.liveTruncated,
      liveTruncatedAfter: inputs.liveTruncated,
      selectedCount: 0,
      compactedCount: 0,
      graveyardEntriesWritten: 0,
      graveyardFile: graveyardPath,
      affectedNodeCount: 0,
      compactedEdges: [],
      hotHubsBefore: plan.beforeCost.hotHubs,
      hotHubsAfter: plan.beforeCost.hotHubs,
      snapshotRebuilt: false
    };
  }

  const engine = deps?.engine;
  if (
    !engine ||
    typeof engine.kvGet !== "function" ||
    typeof engine.kvSet !== "function" ||
    typeof engine.kvDelete !== "function" ||
    typeof engine.applyRetrievalRecord !== "function"
  ) {
    throw new Error(
      "compactRedundantEdges (dryRun: false) requires deps.engine with kvGet, kvSet, kvDelete, and applyRetrievalRecord"
    );
  }

  let control = await engine.kvGet("mem:graph:retrieval-control", "current");
  if (!control) {
    throw new Error(
      "Missing mem:graph:retrieval-control/current; cannot safely compact edges across 5 KV layers"
    );
  }

  // 1. Archive compacted edges to Cold Graveyard before mutating KV
  const graveyardEntriesWritten = appendEdgeCompactionGraveyard(
    graveyardPath,
    plan.selected,
    inputs.nodeById
  );

  // 2. Sequentially unlink compacted edges from mem:graph:retrieval-data & retrieval-control
  for (const item of plan.selected) {
    const res = await engine.applyRetrievalRecord(control, "edge", item.edge.id, null);
    if (res && res.next) {
      control = res.next;
    }
  }

  // Build fallback map for any remaining live edge sharing the same edge-key
  const survivingByEdgeKey = new Map();
  for (const e of plan.remainingEdges) {
    if (!e || e.stale) continue;
    const eKey = `${e.sourceNodeId}|${e.targetNodeId}|${e.type}`;
    if (!survivingByEdgeKey.has(eKey)) {
      survivingByEdgeKey.set(eKey, e.id);
    }
  }

  // 3. Delete canonical edge records, edge-key entries, and edge-history entries
  const handledEdgeKeys = new Set();
  for (let i = 0; i < plan.selected.length; i += 20) {
    const chunk = plan.selected.slice(i, i + 20);
    await Promise.all(
      chunk.flatMap(({ edge }) => {
        const eKey = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`;
        const ops = [
          engine.kvDelete("mem:graph:edges", edge.id),
          engine.kvDelete("mem:graph:edge-history", edge.id).catch(() => {})
        ];
        if (!handledEdgeKeys.has(eKey)) {
          handledEdgeKeys.add(eKey);
          const replacementId = survivingByEdgeKey.get(eKey);
          if (replacementId) {
            ops.push(engine.kvSet("mem:graph:edge-key", eKey, replacementId));
          } else {
            ops.push(engine.kvDelete("mem:graph:edge-key", eKey));
          }
        }
        return ops;
      })
    );
  }

  // 4. Recompute accurate global node degrees for affected endpoints and update mem:graph:node-degree
  const remainingDegMap = new Map();
  for (const e of plan.remainingEdges) {
    if (!e || e.stale) continue;
    remainingDegMap.set(e.sourceNodeId, (remainingDegMap.get(e.sourceNodeId) || 0) + 1);
    remainingDegMap.set(e.targetNodeId, (remainingDegMap.get(e.targetNodeId) || 0) + 1);
  }
  const affectedList = Array.from(affectedNodeIds);
  for (let i = 0; i < affectedList.length; i += 24) {
    const batch = affectedList.slice(i, i + 24);
    await Promise.all(
      batch.map((nodeId) =>
        engine.kvSet("mem:graph:node-degree", nodeId, remainingDegMap.get(nodeId) || 0)
      )
    );
  }

  // 5. Persist final retrieval-control state & trigger snapshot rebuild
  await engine.kvSet("mem:graph:retrieval-control", "current", control);
  let snapshotRebuilt = false;
  let snapshotRebuildError = null;
  try {
    snapshotRebuilt = await triggerSnapshotRebuild(deps, options);
  } catch (err) {
    snapshotRebuildError = err?.message || String(err);
  }

  let liveTruncatedAfter = inputs.liveTruncated;
  if (inputs.liveQueryAvailable) {
    try {
      const postInputs = await resolveGraphInputs(
        {
          ...deps,
          allNodes: inputs.allNodes,
          allEdges: plan.remainingEdges
        },
        { queryLimit: inputs.queryLimit, fetch: options?.fetch }
      );
      if (postInputs.liveTruncated !== null) {
        liveTruncatedAfter = postInputs.liveTruncated;
      }
    } catch {
      // Keep prior value if post-query fails
    }
  }

  return {
    status: "compacted",
    dryRun: false,
    targetMaxReads,
    limit,
    minDegree,
    alreadyWithinBudget: false,
    estimatedReadsBefore: plan.beforeCost.estimatedReads,
    estimatedReadsAfter: plan.afterCost.estimatedReads,
    estimatedReadsSaved:
      plan.beforeCost.estimatedReads - plan.afterCost.estimatedReads,
    wouldTruncateBefore: plan.beforeCost.wouldTruncate,
    wouldTruncateAfter: plan.afterCost.wouldTruncate,
    liveTruncatedBefore: inputs.liveTruncated,
    liveTruncatedAfter,
    selectedCount: plannedDescriptors.length,
    compactedCount: plannedDescriptors.length,
    graveyardEntriesWritten,
    graveyardFile: graveyardPath,
    affectedNodeCount: affectedNodeIds.size,
    totalStoreNodes: control?.nodes ?? null,
    totalStoreEdges: control?.edges ?? null,
    snapshotRebuilt,
    ...(snapshotRebuildError ? { snapshotRebuildError } : {}),
    compactedEdges: plannedDescriptors,
    hotHubsBefore: plan.beforeCost.hotHubs,
    hotHubsAfter: plan.afterCost.hotHubs
  };
}
