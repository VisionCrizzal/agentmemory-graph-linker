#!/usr/bin/env node
/**
 * AgentMemory Knowledge Graph Linker & Beautifier
 * Zero-Token / Lightweight-Model Graph Linker for Antigravity (Gemini 3.8 Flash High)
 *
 * Usage:
 *   node graph-linker.mjs --status
 *   node graph-linker.mjs --auto
 *   node graph-linker.mjs --beautify
 *   node graph-linker.mjs --dump
 *   node graph-linker.mjs --apply '<json_relations_array>'
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const SECRET_PATH = path.join(HOME, ".agentmemory", "secret");
const BASE_URL = process.env.AGENTMEMORY_URL || "http://localhost:3111";

function getSecret() {
  if (process.env.AGENTMEMORY_SECRET) return process.env.AGENTMEMORY_SECRET.trim();
  return fs.readFileSync(SECRET_PATH, "utf8").trim();
}

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const VALID_RELATIONS = new Set([
  "uses",
  "imports",
  "modifies",
  "causes",
  "fixes",
  "depends_on",
  "related_to"
]);

function normalizeRelation(rel) {
  const clean = String(rel || "related_to").toLowerCase().trim();
  return VALID_RELATIONS.has(clean) ? clean : "related_to";
}

// 6 Thematic Domain Constellations for Balanced Layout
const THEMATIC_DOMAINS = [
  {
    id: "ai_models",
    label: "AI Models & Smart Router",
    anchor: { name: "Smart AI Router", type: "pattern" },
    subAnchor: { name: "OpenAI chat completions API", type: "concept" },
    keywords: [
      "groq", "gemini", "gemma", "qwen", "openai", "token", "prompt", "completion",
      "router", "embedding", "tpm", "tpd", "rate limit", "llm", "ai", "model"
    ]
  },
  {
    id: "agentmemory",
    label: "AgentMemory System Core",
    anchor: { name: "agentmemory module", type: "concept" },
    subAnchor: { name: "agent memory implementation", type: "concept" },
    keywords: [
      "agentmemory", "summarize", "compress", "state_store", "metrics", "graph-extract",
      "observation", "session", "kv", "health", "doctor", "sqlite", "sync"
    ]
  },
  {
    id: "mobile_nodes",
    label: "Mobile & Remote AI Ecosystem",
    anchor: { name: "Samsung Galaxy Z Fold 3", type: "concept" },
    subAnchor: { name: "CleanYourTV", type: "concept" },
    keywords: [
      "samsung", "fold", "termux", "ssh", "adb", "android", "tv", "cleanyourtv",
      "scrcpy", "canta", "shizuku", "battery", "phantom"
    ]
  },
  {
    id: "flutter_ui",
    label: "Flutter Architecture & UI",
    anchor: { name: "Flutter", type: "concept" },
    subAnchor: { name: "ShopEasy Architecture", type: "concept" },
    keywords: [
      "flutter", "dart", "shopeasy", "ui", "widget", "theme", "material", "carousel",
      "screen", "splash", "menu_page", "color", "layout"
    ]
  },
  {
    id: "macos_audio",
    label: "macOS CoreAudio & Hardware",
    anchor: { name: "MacBook Pro", type: "concept" },
    subAnchor: { name: "CoreAudio HAL", type: "concept" },
    keywords: [
      "audio", "coreaudio", "hal", "ark", "driver", "amcp", "plug-in", "volume",
      "applescript", "macbook", "dgpu", "thermal", "kernel", "fedora", "coreaudiod"
    ]
  },
  {
    id: "dev_tooling",
    label: "Dev Tools & Automation",
    anchor: { name: "Antigravity Skill", type: "concept" },
    subAnchor: { name: "call_mcp_tool", type: "concept" },
    keywords: [
      "git", "npm", "node", "mcp", "tool", "run_command", "bash", "cli", "launchctl",
      "plist", "service", "workflow", "config", "settings", "json", "yaml"
    ]
  }
];

// Central Backbone Bridges connecting the 6 domain anchors into a harmonic constellation
const INTER_CLUSTER_BRIDGES = [
  { source: "Antigravity Skill", target: "Smart AI Router", type: "uses" },
  { source: "Smart AI Router", target: "agentmemory module", type: "modifies" },
  { source: "Smart AI Router", target: "Samsung Galaxy Z Fold 3", type: "depends_on" },
  { source: "MacBook Pro", target: "agentmemory module", type: "uses" },
  { source: "Antigravity Skill", target: "Flutter", type: "modifies" },
  { source: "Samsung Galaxy Z Fold 3", target: "MacBook Pro", type: "depends_on" },
  { source: "agentmemory module", target: "Smart AI Router", type: "depends_on" },
  { source: "CoreAudio HAL", target: "MacBook Pro", type: "depends_on" },
  { source: "ShopEasy Architecture", target: "Flutter", type: "depends_on" }
];

async function queryGraph(secret, limit = 500) {
  const res = await fetch(`${BASE_URL}/agentmemory/graph/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ limit })
  });
  if (!res.ok) throw new Error(`graph/query failed: HTTP ${res.status}`);
  const data = await res.json();
  const nodes = data.nodes || [];
  const edges = data.edges || [];

  const linkedIds = new Set();
  const degrees = {};
  for (const e of edges) {
    linkedIds.add(e.sourceNodeId);
    linkedIds.add(e.targetNodeId);
    degrees[e.sourceNodeId] = (degrees[e.sourceNodeId] || 0) + 1;
    degrees[e.targetNodeId] = (degrees[e.targetNodeId] || 0) + 1;
  }
  const unlinked = nodes
    .map((n, idx) => ({ ...n, idx, degree: degrees[n.id] || 0 }))
    .filter((n) => !linkedIds.has(n.id));

  return {
    data,
    nodes: nodes.map((n, idx) => ({ ...n, idx, degree: degrees[n.id] || 0 })),
    edges,
    unlinked,
    degrees
  };
}

function classifyNodeDomain(node) {
  const name = (node.name || "").toLowerCase();
  const type = node.type || "concept";

  let bestDomain = THEMATIC_DOMAINS[5]; // default: dev_tooling
  let maxScore = 0;

  for (const d of THEMATIC_DOMAINS) {
    let score = 0;
    for (const kw of d.keywords) {
      if (name.includes(kw)) score += 2;
    }
    if (score > maxScore) {
      maxScore = score;
      bestDomain = d;
    }
  }

  // Type-based fine tuning
  if (type === "file" && name.includes("dart")) bestDomain = THEMATIC_DOMAINS[3]; // Flutter
  if (type === "file" && (name.includes("smart-router") || name.includes("router"))) bestDomain = THEMATIC_DOMAINS[0]; // AI
  if (type === "file" && name.includes("audio")) bestDomain = THEMATIC_DOMAINS[4]; // macOS audio

  return bestDomain;
}

function determineSemanticRelation(node, anchor) {
  const type = node.type || "concept";
  const name = (node.name || "").toLowerCase();

  if (type === "file") {
    if (name.endsWith(".mjs") || name.endsWith(".js") || name.endsWith(".dart") || name.endsWith(".sh")) {
      return "modifies";
    }
    if (name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".plist") || name.endsWith(".env")) {
      return "depends_on";
    }
    return "modifies";
  }

  if (type === "library") return "depends_on";
  if (type === "command") return "uses";
  if (type === "error" || name.includes("fix") || name.includes("error") || name.includes("repair")) return "fixes";
  if (type === "decision") return "optimizes_for";

  if (name.includes("api") || name.includes("service") || name.includes("tool")) return "uses";
  if (name.includes("model") || name.includes("engine") || name.includes("hal")) return "depends_on";

  return "related_to";
}

function pickSemanticAnchor(unlinkedNode, frontAnchors, fallbackIdx) {
  const name = (unlinkedNode.name || "").toLowerCase();
  const type = unlinkedNode.type || "concept";

  for (const anchor of frontAnchors) {
    if (anchor.name === unlinkedNode.name && anchor.type === unlinkedNode.type) continue;
    const aName = (anchor.name || "").toLowerCase();
    if (
      (type === "file" && (anchor.type === "file" || aName.includes("file") || aName.includes("read") || aName.includes("workspace"))) ||
      ((name.includes("mcp") || name.includes("tool") || name.includes("memory")) && aName.includes("mcp")) ||
      ((name.includes("command") || name.includes("bash") || name.includes("cli") || name.includes("sh")) && aName.includes("command")) ||
      ((name.includes("config") || name.includes("env") || name.includes("plist") || name.includes("json")) && aName.includes("config")) ||
      ((name.includes("node") || name.includes("js") || name.includes("mjs") || name.includes("npm")) && (aName.includes("node") || aName.includes("module")))
    ) {
      return {
        anchor,
        relation: type === "file" ? "modifies" : "related_to"
      };
    }
  }

  const fallback = frontAnchors[fallbackIdx % frontAnchors.length];
  return {
    anchor: fallback,
    relation: "related_to"
  };
}

async function applyDirectXmlLinks(secret, entities, relationships) {
  if (!relationships.length) return { success: true, edgesAdded: 0, nodesAdded: 0 };

  const entitiesXml = entities
    .map((n) => `<entity type="${escapeXml(n.type)}" name="${escapeXml(n.name)}"/>`)
    .join("");
  const relsXml = relationships
    .map(
      (r) =>
        `<relationship type="${normalizeRelation(r.type)}" source="${escapeXml(r.source)}" target="${escapeXml(r.target)}" weight="0.9"/>`
    )
    .join("");

  const res = await fetch(`${BASE_URL}/agentmemory/graph/extract`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      observations: [
        {
          id: `obs_direct_graph_linker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: "decision",
          title: "DIRECT_GRAPH_XML",
          narrative: `<entities>${entitiesXml}</entities><relationships>${relsXml}</relationships>`,
          concepts: [],
          files: []
        }
      ]
    })
  });
  if (!res.ok) throw new Error(`graph/extract failed: HTTP ${res.status}`);
  return res.json();
}

async function rebuildSnapshot(secret) {
  await fetch(`${BASE_URL}/agentmemory/graph/snapshot-rebuild`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  }).catch(() => {});
}

async function runBeautify(secret) {
  console.log("🎨 [Beautify] Analyzing graph topology and thematic clusters...");
  const { nodes, edges, unlinked } = await queryGraph(secret);
  const nodeByName = new Map(nodes.map((n) => [n.name, n]));

  // Ensure all domain anchors are registered as entities
  const entitiesMap = new Map();
  for (const d of THEMATIC_DOMAINS) {
    entitiesMap.set(`${d.anchor.type}:${d.anchor.name}`, d.anchor);
    entitiesMap.set(`${d.subAnchor.type}:${d.subAnchor.name}`, d.subAnchor);
  }

  // 1. Establish Inter-Cluster Central Backbone Bridges
  const rels = [];
  const existingPairSet = new Set(
    edges.map((e) => {
      const s = nodeByName.get(e.sourceNodeId);
      const t = nodeByName.get(e.targetNodeId);
      return s && t ? `${s.name}|${t.name}` : "";
    })
  );

  for (const bridge of INTER_CLUSTER_BRIDGES) {
    const pair1 = `${bridge.source}|${bridge.target}`;
    const pair2 = `${bridge.target}|${bridge.source}`;
    if (!existingPairSet.has(pair1) && !existingPairSet.has(pair2)) {
      rels.push({
        source: bridge.source,
        target: bridge.target,
        type: bridge.type
      });
      existingPairSet.add(pair1);
    }
  }

  // 2. Classify and balance nodes into the 6 domain clusters
  const clusterCounts = {};
  const anchorCap = 25; // max edges per main anchor to avoid crowded hairballs
  const anchorUsage = {};

  for (const d of THEMATIC_DOMAINS) {
    clusterCounts[d.id] = 0;
    anchorUsage[d.anchor.name] = 0;
    anchorUsage[d.subAnchor.name] = 0;
  }

  // Connect any unlinked or weakly connected leaf nodes (degree <= 1) to balanced thematic anchors
  const candidates = nodes.filter((n) => n.degree <= 1 || unlinked.some((u) => u.id === n.id));
  console.log(`🎨 [Beautify] Balancing ${candidates.length} candidate leaf & unlinked nodes across 6 clusters...`);

  for (const node of candidates) {
    const domain = classifyNodeDomain(node);
    clusterCounts[domain.id] = (clusterCounts[domain.id] || 0) + 1;

    // Pick main anchor if under cap, otherwise spill over to subAnchor
    const targetAnchor =
      (anchorUsage[domain.anchor.name] || 0) < anchorCap ? domain.anchor : domain.subAnchor;
    anchorUsage[targetAnchor.name] = (anchorUsage[targetAnchor.name] || 0) + 1;

    if (node.name !== targetAnchor.name) {
      const pair1 = `${node.name}|${targetAnchor.name}`;
      const pair2 = `${targetAnchor.name}|${node.name}`;
      if (!existingPairSet.has(pair1) && !existingPairSet.has(pair2)) {
        entitiesMap.set(`${node.type}:${node.name}`, node);
        entitiesMap.set(`${targetAnchor.type}:${targetAnchor.name}`, targetAnchor);
        const relType = determineSemanticRelation(node, targetAnchor);
        rels.push({
          source: node.name,
          target: targetAnchor.name,
          type: relType
        });
        existingPairSet.add(pair1);
      }
    }
  }

  console.log(`🎨 [Beautify] Injecting ${rels.length} balanced semantic relationships via DIRECT_GRAPH_XML...`);
  const extractRes = await applyDirectXmlLinks(secret, Array.from(entitiesMap.values()), rels);
  console.log(`🎨 [Beautify] Graph extraction completed: +${extractRes.edgesAdded} edges.`);

  console.log("🎨 [Beautify] Rebuilding snapshot cache...");
  await rebuildSnapshot(secret);

  // 3. Final zero-unlinked sweep if any newly added anchors or nodes remained isolated
  let final = await queryGraph(secret);
  if (final.unlinked.length > 0) {
    console.log(`🎨 [Beautify] Sweeping ${final.unlinked.length} remaining isolated nodes...`);
    const sweepEntities = new Map();
    const sweepRels = [];
    const frontAnchor = final.nodes[0] || { name: "call_mcp_tool", type: "concept" };
    sweepEntities.set(`${frontAnchor.type}:${frontAnchor.name}`, frontAnchor);

    for (const u of final.unlinked) {
      if (u.name === frontAnchor.name) continue;
      sweepEntities.set(`${u.type}:${u.name}`, u);
      sweepRels.push({
        source: u.name,
        target: frontAnchor.name,
        type: "related_to"
      });
    }

    if (sweepRels.length > 0) {
      await applyDirectXmlLinks(secret, Array.from(sweepEntities.values()), sweepRels);
      await rebuildSnapshot(secret);
      final = await queryGraph(secret);
    }
  }
  const edgeTypeCounts = {};
  for (const e of final.edges) {
    edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] || 0) + 1;
  }

  const degValues = Object.values(final.degrees);
  const maxDeg = degValues.length ? Math.max(...degValues) : 0;
  const avgDeg = degValues.length
    ? (degValues.reduce((a, b) => a + b, 0) / degValues.length).toFixed(1)
    : 0;

  console.log(
    JSON.stringify(
      {
        status: "beautified",
        unlinkedCount: final.unlinked.length,
        sparseWarningActive: final.unlinked.length > Math.floor(final.nodes.length * 0.1),
        viewNodes: final.nodes.length,
        viewEdges: final.edges.length,
        maxDegree: maxDeg,
        avgDegree: avgDeg,
        clusters: THEMATIC_DOMAINS.map((d) => ({
          domain: d.label,
          mainAnchor: d.anchor.name,
          assignedNodes: clusterCounts[d.id] || 0
        })),
        edgeTypeDiversity: edgeTypeCounts
      },
      null,
      2
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "--status";
  const secret = getSecret();

  if (mode === "--status") {
    const { data, nodes, edges, unlinked, degrees } = await queryGraph(secret);
    const edgeTypes = {};
    for (const e of edges) edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1;
    const degValues = Object.values(degrees);
    const maxDeg = degValues.length ? Math.max(...degValues) : 0;
    const avgDeg = degValues.length
      ? (degValues.reduce((a, b) => a + b, 0) / degValues.length).toFixed(1)
      : 0;

    console.log(
      JSON.stringify(
        {
          totalStoreNodes: data.totalNodes,
          totalStoreEdges: data.totalEdges,
          viewNodes: nodes.length,
          viewEdges: edges.length,
          unlinkedCount: unlinked.length,
          sparseWarningActive: unlinked.length > Math.floor(nodes.length * 0.1),
          maxDegree: maxDeg,
          avgDegree: avgDeg,
          edgeTypes,
          frontAnchors: nodes.slice(0, 10).map((n) => ({ idx: n.idx, name: n.name, type: n.type, degree: n.degree })),
          sampleUnlinked: unlinked.slice(0, 15).map((n) => ({ idx: n.idx, name: n.name, type: n.type }))
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === "--beautify") {
    await runBeautify(secret);
    return;
  }

  if (mode === "--dump") {
    const { nodes, unlinked } = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          frontAnchors: nodes.slice(0, 12).map((n) => ({ idx: n.idx, name: n.name, type: n.type, degree: n.degree })),
          unlinkedCount: unlinked.length,
          unlinked: unlinked.map((n) => ({ idx: n.idx, name: n.name, type: n.type }))
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === "--apply") {
    const rawJson = args[1];
    if (!rawJson) throw new Error("Usage: graph-linker.mjs --apply '<json_array>'");
    const customLinks = JSON.parse(rawJson);
    const { nodes } = await queryGraph(secret);
    const nodeByName = new Map(nodes.map((n) => [n.name, n]));

    const entitiesMap = new Map();
    const rels = [];
    for (const item of customLinks) {
      const sNode = nodeByName.get(item.source) || { name: item.source, type: item.sourceType || "concept" };
      const tNode = nodeByName.get(item.target) || { name: item.target, type: item.targetType || "concept" };
      entitiesMap.set(`${sNode.type}:${sNode.name}`, sNode);
      entitiesMap.set(`${tNode.type}:${tNode.name}`, tNode);
      rels.push({
        source: sNode.name,
        target: tNode.name,
        type: normalizeRelation(item.type || item.relation)
      });
    }

    const result = await applyDirectXmlLinks(secret, Array.from(entitiesMap.values()), rels);
    await rebuildSnapshot(secret);
    const after = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          applied: result,
          remainingUnlinked: after.unlinked.length,
          viewEdges: after.edges.length
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === "--auto") {
    const anchorWindows = [10, 6, 4];
    for (let pass = 0; pass < anchorWindows.length; pass++) {
      const { nodes, edges, unlinked } = await queryGraph(secret);
      console.log(`[Pass ${pass + 1}] View nodes: ${nodes.length}, View edges: ${edges.length}, Unlinked: ${unlinked.length}`);
      if (unlinked.length === 0) break;

      const windowSize = anchorWindows[pass];
      const frontAnchors = nodes.slice(0, windowSize);
      const entitiesMap = new Map();
      for (const a of frontAnchors) entitiesMap.set(`${a.type}:${a.name}`, a);
      for (const u of unlinked) entitiesMap.set(`${u.type}:${u.name}`, u);

      const rels = [];
      for (let i = 0; i < unlinked.length; i++) {
        const u = unlinked[i];
        const { anchor, relation } = pickSemanticAnchor(u, frontAnchors, i);
        if (u.name !== anchor.name || u.type !== anchor.type) {
          rels.push({
            source: u.name,
            target: anchor.name,
            type: relation
          });
        }
      }

      const res = await applyDirectXmlLinks(secret, Array.from(entitiesMap.values()), rels);
      console.log(`[Pass ${pass + 1}] Linked +${res.edgesAdded} edges (0 external LLM tokens).`);
    }

    await rebuildSnapshot(secret);
    const finalState = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          status: "completed",
          totalStoreNodes: finalState.data.totalNodes,
          totalStoreEdges: finalState.data.totalEdges,
          viewNodes: finalState.nodes.length,
          viewEdges: finalState.edges.length,
          unlinkedCount: finalState.unlinked.length
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown flag: ${mode}. Use --status, --auto, --beautify, --dump, or --apply.`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
