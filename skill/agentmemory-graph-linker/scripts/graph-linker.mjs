#!/usr/bin/env node
/**
 * AgentMemory Knowledge Graph Linker
 * Zero-Token / Lightweight-Model Graph Linker for Antigravity (Gemini 3.8 Flash High)
 *
 * Usage:
 *   node graph-linker.mjs --status
 *   node graph-linker.mjs --auto
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
  for (const e of edges) {
    linkedIds.add(e.sourceNodeId);
    linkedIds.add(e.targetNodeId);
  }
  const unlinked = nodes
    .map((n, idx) => ({ ...n, idx }))
    .filter((n) => !linkedIds.has(n.id));

  return {
    data,
    nodes,
    edges,
    unlinked
  };
}

function pickSemanticAnchor(unlinkedNode, frontAnchors, fallbackIdx) {
  const name = (unlinkedNode.name || "").toLowerCase();
  const type = unlinkedNode.type || "concept";

  // Match by domain keywords against frontAnchors[0..N]
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

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "--status";
  const secret = getSecret();

  if (mode === "--status") {
    const { data, nodes, edges, unlinked } = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          totalStoreNodes: data.totalNodes,
          totalStoreEdges: data.totalEdges,
          viewNodes: nodes.length,
          viewEdges: edges.length,
          unlinkedCount: unlinked.length,
          sparseWarningActive: unlinked.length > Math.floor(nodes.length * 0.1),
          frontAnchors: nodes.slice(0, 10).map((n, idx) => ({ idx, name: n.name, type: n.type })),
          sampleUnlinked: unlinked.slice(0, 15).map((n) => ({ idx: n.idx, name: n.name, type: n.type }))
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === "--dump") {
    const { nodes, unlinked } = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          frontAnchors: nodes.slice(0, 12).map((n, idx) => ({ idx, name: n.name, type: n.type })),
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
    // Progressive front-anchor convergence (uses top 10 -> 6 -> 4 front anchors so edges stay at root.head of pageNodes[0..9])
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

  throw new Error(`Unknown flag: ${mode}. Use --status, --auto, --dump, or --apply.`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
