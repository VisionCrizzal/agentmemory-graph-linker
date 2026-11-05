#!/usr/bin/env node
/**
 * AgentMemory Knowledge Graph Linker, Beautifier, Cleaner & Healer (v2.2)
 * Zero-Token / Lightweight-Model Graph Toolkit for Antigravity
 *
 * Usage:
 *   node graph-linker.mjs --status
 *   node graph-linker.mjs --auto
 *   node graph-linker.mjs --beautify
 *   node graph-linker.mjs --dump
 *   node graph-linker.mjs --apply '<json_relations_array_or_filepath>'
 *   node graph-linker.mjs --delete "<node_name_or_id>" ["<more_names_or_ids>..."]
 *   node graph-linker.mjs --heal   (alias: --drain)
 *   node graph-linker.mjs --logs   [--reset-cursor]
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const HOME = os.homedir();
const AGENTMEMORY_DIR = process.env.AGENTMEMORY_DATA_DIR || path.join(HOME, ".agentmemory");
const SECRET_PATH = path.join(AGENTMEMORY_DIR, "secret");
const LOG_CURSOR_PATH = path.join(AGENTMEMORY_DIR, ".log-heal-cursor.json");
const BASE_URL = process.env.AGENTMEMORY_URL || "http://localhost:3111";
const III_WS_URL = process.env.AGENTMEMORY_WS_URL || "ws://127.0.0.1:49134";
const III_NAMESPACE = process.env.AGENTMEMORY_NAMESPACE || "agentmemory-3111";
const III_SDK_PATH =
  "/usr/local/lib/node_modules/@agentmemory/agentmemory/node_modules/iii-sdk/dist/index.mjs";

const LOG_PATHS = [
  path.join(AGENTMEMORY_DIR, "mcp-crash.log"),
  path.join(AGENTMEMORY_DIR, "mcp-crash.log.1"),
  path.join(os.tmpdir(), "agentmemory-mcp-crash.log"),
  path.join(HOME, "Library", "Logs", "agentmemory.error.log"),
  path.join(HOME, "Library", "Logs", "agentmemory.log")
];

function getSecret() {
  if (process.env.AGENTMEMORY_SECRET) return process.env.AGENTMEMORY_SECRET.trim();
  return fs.readFileSync(SECRET_PATH, "utf8").trim();
}

/**
 * Strips lone UTF-16 surrogates (#1598) and escapes XML entities safely.
 */
function stripLoneSurrogates(str) {
  return String(str ?? "").replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    ""
  );
}

function escapeXml(str) {
  return stripLoneSurrogates(str)
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

const NODE_TYPES = new Set([
  "concept", "entity", "decision", "error", "file", "function", "pattern", "person",
  "command", "service", "library", "milestone", "action", "platform", "server", "task",
  "tool", "notification", "game", "search", "organization", "event"
]);

const EDGE_TYPES = new Set([
  "uses", "imports", "modifies", "causes", "fixes", "depends_on", "related_to",
  "works_at", "prefers", "blocked_by", "caused_by", "optimizes_for", "rejected",
  "avoids", "located_in", "succeeded_by"
]);

function normalizeRelation(rel) {
  const clean = String(rel || "related_to").toLowerCase().trim();
  if (clean === "optimizes_for") return "modifies";
  if (clean === "caused_by") return "causes";
  if (clean === "blocked_by") return "depends_on";
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
      "router", "embedding", "tpm", "tpd", "rate limit", "llm", "ai", "model", "gpt"
    ]
  },
  {
    id: "agentmemory",
    label: "AgentMemory System Core",
    anchor: { name: "agentmemory module", type: "concept" },
    subAnchor: { name: "memory persistence", type: "concept" },
    keywords: [
      "agentmemory", "summarize", "compress", "state_store", "metrics", "graph",
      "observation", "session", "kv", "health", "doctor", "sqlite", "sync", "memory", "recall"
    ]
  },
  {
    id: "mobile_nodes",
    label: "Mobile & Remote AI Ecosystem",
    anchor: { name: "mobile-design", type: "concept" },
    subAnchor: { name: "Samsung Galaxy Z Fold 3", type: "concept" },
    keywords: [
      "samsung", "fold", "termux", "ssh", "adb", "android", "tv", "cleanyourtv",
      "scrcpy", "canta", "shizuku", "battery", "phantom", "pixel", "motorola", "hyperos", "zalo", "tiktok"
    ]
  },
  {
    id: "flutter_ui",
    label: "Flutter Architecture & UI",
    anchor: { name: "flutter-expert", type: "concept" },
    subAnchor: { name: "ui-states", type: "concept" },
    keywords: [
      "flutter", "dart", "shopeasy", "ui", "widget", "theme", "material", "carousel",
      "screen", "splash", "menu_page", "color", "layout", "animation", "chrome"
    ]
  },
  {
    id: "macos_audio",
    label: "macOS CoreAudio & Hardware",
    anchor: { name: "MacBook Pro", type: "concept" },
    subAnchor: { name: "CoreAudio HAL", type: "concept" },
    keywords: [
      "audio", "coreaudio", "hal", "ark", "driver", "amcp", "plug-in", "volume",
      "applescript", "macbook", "dgpu", "thermal", "kernel", "fedora", "coreaudiod", "xcode", "egpu"
    ]
  },
  {
    id: "dev_tooling",
    label: "Dev Tools & Automation",
    anchor: { name: "/Users/crydamoure/.claude/skills", type: "file" },
    subAnchor: { name: "git-pushing", type: "concept" },
    keywords: [
      "git", "npm", "node", "mcp", "tool", "run_command", "bash", "cli", "launchctl",
      "plist", "service", "workflow", "config", "settings", "json", "yaml", "skill", "firefox", "vscode"
    ]
  }
];

// Central Backbone Bridges connecting the 6 domain anchors into a harmonic constellation
const INTER_CLUSTER_BRIDGES = [
  { source: "/Users/crydamoure/.claude/skills", sourceType: "file", target: "Smart AI Router", targetType: "pattern", type: "uses" },
  { source: "Smart AI Router", sourceType: "pattern", target: "agentmemory module", targetType: "concept", type: "modifies" },
  { source: "mobile-design", sourceType: "concept", target: "flutter-expert", targetType: "concept", type: "depends_on" },
  { source: "MacBook Pro", sourceType: "concept", target: "agentmemory module", targetType: "concept", type: "uses" },
  { source: "/Users/crydamoure/.claude/skills", sourceType: "file", target: "flutter-expert", targetType: "concept", type: "uses" },
  { source: "git-pushing", sourceType: "concept", target: "/Users/crydamoure/.claude/skills", targetType: "file", type: "uses" }
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

  if (type === "file" && name.includes("dart")) bestDomain = THEMATIC_DOMAINS[3];
  if (type === "file" && (name.includes("smart-router") || name.includes("router"))) bestDomain = THEMATIC_DOMAINS[0];
  if (type === "file" && name.includes("audio")) bestDomain = THEMATIC_DOMAINS[4];

  return bestDomain;
}

function determineSemanticRelation(node) {
  const type = node.type || "concept";
  const name = (node.name || "").toLowerCase();

  if (type === "file") {
    if (name.endsWith(".md") || name.includes("/skills") || name.includes("/profiles") || name.endsWith("/")) {
      return "imports";
    }
    if (name.endsWith(".mjs") || name.endsWith(".js") || name.endsWith(".dart") || name.endsWith(".sh")) {
      return "modifies";
    }
    if (name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".plist") || name.endsWith(".env")) {
      return "depends_on";
    }
    return "imports";
  }

  if (type === "library" || type === "pattern") return "depends_on";
  if (type === "command" || type === "function" || type === "tool" || type === "action" || type === "search") return "uses";
  if (type === "error") return name.includes("not found") || name.includes("fail") ? "causes" : "fixes";
  if (type === "decision") return name.includes("fix") || name.includes("use") ? "fixes" : "modifies";

  if (name.includes("fix") || name.includes("error") || name.includes("repair")) return "fixes";
  if (name.includes("api") || name.includes("service") || name.includes("tool") || name.includes("query")) return "uses";
  if (name.includes("setup") || name.includes("init") || name.includes("install") || name.includes("plan")) return "depends_on";
  if (name.includes("clean") || name.includes("update") || name.includes("modif") || name.includes("config")) return "modifies";

  return "uses";
}

function pickSemanticAnchor(unlinkedNode, frontAnchors, fallbackIdx) {
  const name = (unlinkedNode.name || "").toLowerCase();
  const type = unlinkedNode.type || "concept";
  const rel = determineSemanticRelation(unlinkedNode);

  for (const anchor of frontAnchors) {
    if (anchor.name === unlinkedNode.name && anchor.type === unlinkedNode.type) continue;
    const aName = (anchor.name || "").toLowerCase();
    if (
      (type === "file" && (anchor.type === "file" || aName.includes("skill") || aName.includes("file"))) ||
      ((name.includes("firefox") || name.includes("chrome") || name.includes("extension") || name.includes("profile")) &&
        (aName.includes("chrome") || aName.includes("skill"))) ||
      ((name.includes("mobile") || name.includes("zalo") || name.includes("tiktok") || name.includes("ui")) &&
        (aName.includes("mobile") || aName.includes("ui") || aName.includes("flutter"))) ||
      ((name.includes("git") || name.includes("repo") || name.includes("github")) && aName.includes("git")) ||
      ((name.includes("animat") || name.includes("motion")) && aName.includes("animat")) ||
      ((name.includes("xcode") || name.includes("flutter") || name.includes("dart")) && aName.includes("flutter"))
    ) {
      return { anchor, relation: rel };
    }
  }

  const candidates = frontAnchors.filter(
    (a) => !(a.name === unlinkedNode.name && a.type === unlinkedNode.type)
  );
  const fallback = candidates[fallbackIdx % Math.max(1, candidates.length)] || frontAnchors[0];
  return {
    anchor: fallback,
    relation: rel
  };
}

/**
 * Splits relationships into safe batches so two entities with the same `name`
 * but different `type` never collide in `parseGraphXml`'s name-keyed Map.
 */
async function applyDirectXmlLinks(secret, entities, relationships) {
  if (!relationships.length) return { success: true, edgesAdded: 0, nodesAdded: 0 };

  let totalEdgesAdded = 0;
  let totalNodesAdded = 0;

  // Group relationships into non-colliding batches
  const batches = [];
  for (const r of relationships) {
    const sType = r.sourceType || "concept";
    const tType = r.targetType || "concept";

    // Self-loop with identical name cannot be represented in name-keyed XML; skip
    if (r.source === r.target) continue;

    let placed = false;
    for (const batch of batches) {
      const existingSType = batch.entityTypeByName.get(r.source);
      const existingTType = batch.entityTypeByName.get(r.target);
      if (
        (!existingSType || existingSType === sType) &&
        (!existingTType || existingTType === tType)
      ) {
        batch.entityTypeByName.set(r.source, sType);
        batch.entityTypeByName.set(r.target, tType);
        batch.rels.push(r);
        placed = true;
        break;
      }
    }

    if (!placed) {
      const entityTypeByName = new Map();
      entityTypeByName.set(r.source, sType);
      entityTypeByName.set(r.target, tType);
      batches.push({ entityTypeByName, rels: [r] });
    }
  }

  for (const batch of batches) {
    const entitiesXml = Array.from(batch.entityTypeByName.entries())
      .map(([name, type]) => `<entity type="${escapeXml(type)}" name="${escapeXml(name)}"/>`)
      .join("");
    const relsXml = batch.rels
      .map(
        (r) =>
          `<relationship type="${normalizeRelation(r.type)}" source="${escapeXml(r.source)}" target="${escapeXml(r.target)}" weight="${r.weight || 0.9}"/>`
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
    const out = await res.json();
    totalEdgesAdded += out.edgesAdded || 0;
    totalNodesAdded += out.nodesAdded || 0;
  }

  return { success: true, edgesAdded: totalEdgesAdded, nodesAdded: totalNodesAdded, batches: batches.length };
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

/**
 * Token-Saving Incremental Log Inspector & Self-Healer (v2.2, #1662 / #1674)
 * Tracks byte offset + inode in ~/.agentmemory/.log-heal-cursor.json so already-read
 * and already-fixed log lines are NEVER read again (0 token waste on repeat runs).
 */
async function inspectAndHealLogs(secret, options = {}) {
  const MAX_DELTA_BYTES_PER_FILE = 16 * 1024; // Cap initial/rotated tail read to 16KB
  let cursorState = { version: "2.2", files: {} };

  if (!options.resetCursor && fs.existsSync(LOG_CURSOR_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(LOG_CURSOR_PATH, "utf8"));
      if (parsed && typeof parsed.files === "object") cursorState = parsed;
    } catch {}
  }

  const fileReports = [];
  const detectedIssues = new Set();
  const autoHealedActions = [];
  let totalBytesRead = 0;
  let skippedAlreadyReadCount = 0;

  for (const logPath of LOG_PATHS) {
    const label = path.basename(logPath);
    if (!fs.existsSync(logPath)) {
      fileReports.push({ file: label, path: logPath, status: "not_present", unreadBytesRead: 0 });
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(logPath);
    } catch {
      continue;
    }

    const prev = cursorState.files[logPath];
    // Zero-Token Rule: if inode & byte size match the saved cursor, skip reading completely!
    if (
      !options.resetCursor &&
      prev &&
      prev.ino === stat.ino &&
      prev.offset === stat.size
    ) {
      skippedAlreadyReadCount += 1;
      fileReports.push({
        file: label,
        status: "skipped_already_read",
        unreadBytesRead: 0,
        cursorOffset: stat.size
      });
      continue;
    }

    // Calculate delta byte range (only unread bytes, capped at last 16KB)
    let startOffset = 0;
    if (!options.resetCursor && prev && prev.ino === stat.ino && stat.size > prev.offset) {
      startOffset = Math.max(prev.offset, stat.size - MAX_DELTA_BYTES_PER_FILE);
    } else {
      startOffset = Math.max(0, stat.size - MAX_DELTA_BYTES_PER_FILE);
    }

    const bytesToRead = Math.max(0, stat.size - startOffset);
    let deltaText = "";
    if (bytesToRead > 0) {
      let fd;
      try {
        fd = fs.openSync(logPath, "r");
        const buf = Buffer.alloc(bytesToRead);
        const n = fs.readSync(fd, buf, 0, bytesToRead, startOffset);
        deltaText = stripLoneSurrogates(buf.subarray(0, n).toString("utf8"));
        totalBytesRead += n;
      } catch {} finally {
        if (fd !== undefined) {
          try {
            fs.closeSync(fd);
          } catch {}
        }
      }
    }

    // Scan only the new delta lines for actionable error signatures
    const matchedInFile = [];
    if (deltaText) {
      if (/uncaughtException|unhandledRejection|\[@agentmemory\/mcp\] fatal/i.test(deltaText)) {
        detectedIssues.add("mcp_shim_crash");
        matchedInFile.push("mcp_shim_crash");
      }
      if (/Graph index.*paused|needs-migration|Graph index counts are unavailable/i.test(deltaText)) {
        detectedIssues.add("graph_index_paused");
        matchedInFile.push("graph_index_paused");
      }
      if (/No LLM provider chosen|AGENTMEMORY_LLM_PROVIDER/i.test(deltaText)) {
        detectedIssues.add("llm_provider_missing");
        matchedInFile.push("llm_provider_missing");
      }
      if (/OPENAI_API_KEY_FOR_LLM/i.test(deltaText)) {
        detectedIssues.add("deprecated_openai_api_key_for_llm");
        matchedInFile.push("deprecated_openai_api_key_for_llm");
      }
      if (/OpenAI response hit max_tokens|finish_reason.*length/i.test(deltaText)) {
        detectedIssues.add("truncated_openai_reply");
        matchedInFile.push("truncated_openai_reply");
      }
      if (/orphan sweep left shards behind|orphan_generation_sweep/i.test(deltaText)) {
        detectedIssues.add("orphan_index_shards");
        matchedInFile.push("orphan_index_shards");
      }
      if (/EADDRINUSE|compose\.pid|stale pid/i.test(deltaText)) {
        detectedIssues.add("stale_pid_or_port_conflict");
        matchedInFile.push("stale_pid_or_port_conflict");
      }
    }

    // Advance cursor to stat.size so these lines are never read again
    cursorState.files[logPath] = {
      ino: stat.ino,
      offset: stat.size,
      mtimeMs: stat.mtimeMs,
      lastCheckedAt: new Date().toISOString(),
      lastIssuesFound: matchedInFile
    };

    fileReports.push({
      file: label,
      status: bytesToRead > 0 ? "delta_read_and_marked" : "empty_marked",
      unreadBytesRead: bytesToRead,
      cursorOffset: stat.size,
      issuesFound: matchedInFile
    });
  }

  // Execute automatic self-healing for any detected issues in the unread log delta
  if (detectedIssues.has("graph_index_paused")) {
    await fetch(`${BASE_URL}/agentmemory/graph/index/resume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ allowLegacyScan: true })
    }).catch(() => {});
    autoHealedActions.push("resumed_paused_graph_index");
  }

  if (detectedIssues.has("llm_provider_missing") || detectedIssues.has("deprecated_openai_api_key_for_llm")) {
    const envPath = path.join(AGENTMEMORY_DIR, ".env");
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, "utf8");
      let changed = false;
      if (!/^AGENTMEMORY_LLM_PROVIDER=/m.test(envContent) && /^OPENAI_API_KEY=/m.test(envContent)) {
        envContent = envContent.replace(/^OPENAI_API_KEY=/m, "AGENTMEMORY_LLM_PROVIDER=openai\nOPENAI_API_KEY=");
        changed = true;
      }
      if (/^OPENAI_API_KEY_FOR_LLM=/m.test(envContent)) {
        envContent = envContent.replace(/^OPENAI_API_KEY_FOR_LLM=.*\n?/gm, "");
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(envPath, envContent, "utf8");
        autoHealedActions.push("patched_env_llm_provider_and_cleaned_deprecated_keys");
      }
    }
  }

  if (detectedIssues.has("mcp_shim_crash")) {
    // Verify daemon is reachable and flush any pending capture spool left before crash exit
    await fetch(`${BASE_URL}/agentmemory/capture/drain`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      }
    }).catch(() => {});
    autoHealedActions.push("verified_daemon_and_drained_spool_after_mcp_crash");
  }

  if (detectedIssues.has("truncated_openai_reply")) {
    autoHealedActions.push("verified_smart_router_v2.2_finish_reason_length_failover");
  }

  // Persist updated cursor file so subsequent calls skip already-read bytes
  try {
    fs.mkdirSync(path.dirname(LOG_CURSOR_PATH), { recursive: true });
    fs.writeFileSync(LOG_CURSOR_PATH, JSON.stringify(cursorState, null, 2), "utf8");
  } catch {}

  return {
    cursorFile: LOG_CURSOR_PATH,
    totalUnreadBytesRead: totalBytesRead,
    skippedUnchangedFiles: skippedAlreadyReadCount,
    detectedIssues: Array.from(detectedIssues),
    autoHealedActions,
    files: fileReports
  };
}

/**
 * 5-Layer Permanent Node, Incident Edge, Facet & Membership Deletion via iii-sdk WebSocket
 * Includes v0.9.32 Facet Cleanup (#1642) + Graph Membership + Edge History cleanup
 */
async function runDelete(targets) {
  if (!targets.length) {
    throw new Error('Usage: graph-linker.mjs --delete "<node_name_or_id>" ["<more>..."]');
  }

  const { registerWorker } = await import(III_SDK_PATH);
  const worker = registerWorker(III_WS_URL, {
    workerName: `graph-linker-delete-${Date.now()}`,
    namespace: III_NAMESPACE
  });

  const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const recordKey = (buildId, kind, id) => `${buildId}:record:${kind}:${hash(id)}`;
  const rootKey = (buildId, posting) => `${buildId}:root:${posting}`;
  const entryKey = (buildId, posting, id) => `${buildId}:entry:${posting}:${id}`;
  const countKey = (kind) => (kind === "node" ? "nodes" : kind === "edge" ? "edges" : "historyEdges");

  async function planRecord(control, kind, id) {
    const writes = new Map();
    const read = async (key) =>
      writes.has(key)
        ? writes.get(key)
        : await worker.trigger({
            namespace: III_NAMESPACE,
            function_id: "state::get",
            payload: { scope: "mem:graph:retrieval-data", key }
          });
    const put = (key, value) => writes.set(key, value);

    const key = recordKey(control.buildId, kind, id);
    const before = await read(key);
    const after = { row: null, postings: [], incomplete: false };
    const memberId = hash(id);

    const editPosting = async (posting, add) => {
      const rootId = rootKey(control.buildId, posting);
      const itemId = entryKey(control.buildId, posting, memberId);
      const root = (await read(rootId)) ?? { head: null, count: 0 };
      const saved = await read(itemId);

      if (!add) {
        if (!saved) return;
        if (saved.previous) {
          const previousId = entryKey(control.buildId, posting, saved.previous);
          const previous = await read(previousId);
          if (previous) put(previousId, { ...previous, next: saved.next });
        } else {
          root.head = saved.next;
        }
        if (saved.next) {
          const nextId = entryKey(control.buildId, posting, saved.next);
          const next = await read(nextId);
          if (next) put(nextId, { ...next, previous: saved.previous });
        }
        put(itemId, null);
        put(rootId, { head: root.head, count: Math.max(0, root.count - 1) });
      }
    };

    for (const posting of new Set(before?.postings ?? [])) {
      await editPosting(posting, false);
    }
    put(key, after);

    const { pending: _, ...clean } = control;
    const next = {
      ...clean,
      revision: control.revision + 1,
      updatedAt: new Date().toISOString()
    };
    const counted = (row) => Boolean(row && (kind !== "edge" || row.isLatest !== false));
    const cKey = countKey(kind);
    next[cKey] = Math.max(0, next[cKey] + Number(counted(after?.row)) - Number(counted(before?.row)));
    next.incompleteRecords = Math.max(
      0,
      next.incompleteRecords + Number(Boolean(after?.incomplete)) - Number(Boolean(before?.incomplete))
    );

    if (kind !== "history") {
      const field = kind === "node" ? "nodesByType" : "edgesByType";
      const known = kind === "node" ? NODE_TYPES : EDGE_TYPES;
      next[field] = { ...control[field] };
      for (const [row, amount] of [
        [before?.row, -1],
        [after?.row, 1]
      ]) {
        if (!row || !counted(row)) continue;
        const type = known.has(row.type) ? row.type : "other";
        next[field][type] = (next[field][type] ?? 0) + amount;
        if (!next[field][type] || next[field][type] <= 0) delete next[field][type];
        if (type === "other") next.otherTypes = Math.max(0, next.otherTypes + amount);
      }
    }

    return { writes, next };
  }

  const allNodes = await worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "state::list",
    payload: { scope: "mem:graph:nodes" }
  });

  const targetSet = new Set(targets.map((t) => t.trim()));
  const targetLowerSet = new Set(targets.map((t) => t.trim().toLowerCase()));

  const matchedNodes = (allNodes || []).filter(
    (n) =>
      n &&
      (targetSet.has(n.id) ||
        targetSet.has(n.name) ||
        targetLowerSet.has(String(n.name || "").toLowerCase()))
  );

  // Also allow explicit gn_ IDs even if already removed from canonical mem:graph:nodes
  const matchedNodeIds = new Set(matchedNodes.map((n) => n.id));
  for (const t of targetSet) {
    if (t.startsWith("gn_")) matchedNodeIds.add(t);
  }

  if (matchedNodeIds.size === 0) {
    console.log(JSON.stringify({ deletedNodes: [], deletedEdges: [], message: "No matching nodes found." }, null, 2));
    process.exit(0);
  }

  const allEdges = await worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "state::list",
    payload: { scope: "mem:graph:edges" }
  });

  const incidentEdges = (allEdges || []).filter(
    (e) => e && (matchedNodeIds.has(e.sourceNodeId) || matchedNodeIds.has(e.targetNodeId))
  );
  const incidentEdgeIds = new Set(incidentEdges.map((e) => e.id));

  let control = await worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "state::get",
    payload: { scope: "mem:graph:retrieval-control", key: "current" }
  });

  // 1. Unlink incident edges from retrieval index
  for (const edge of incidentEdges) {
    const { writes, next } = await planRecord(control, "edge", edge.id);
    for (const [key, value] of writes.entries()) {
      if (value === null) {
        await worker.trigger({
          namespace: III_NAMESPACE,
          function_id: "state::delete",
          payload: { scope: "mem:graph:retrieval-data", key }
        });
      } else {
        await worker.trigger({
          namespace: III_NAMESPACE,
          function_id: "state::set",
          payload: { scope: "mem:graph:retrieval-data", key, value }
        });
      }
    }
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::set",
      payload: { scope: "mem:graph:retrieval-control", key: "current", value: next }
    });
    control = next;
  }

  // 2. Unlink target nodes from retrieval index
  for (const nodeId of matchedNodeIds) {
    const { writes, next } = await planRecord(control, "node", nodeId);
    for (const [key, value] of writes.entries()) {
      if (value === null) {
        await worker.trigger({
          namespace: III_NAMESPACE,
          function_id: "state::delete",
          payload: { scope: "mem:graph:retrieval-data", key }
        });
      } else {
        await worker.trigger({
          namespace: III_NAMESPACE,
          function_id: "state::set",
          payload: { scope: "mem:graph:retrieval-data", key, value }
        });
      }
    }
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::set",
      payload: { scope: "mem:graph:retrieval-control", key: "current", value: next }
    });
    control = next;
  }

  // 3. Delete canonical edges, edge-keys & edge-history
  for (const edge of incidentEdges) {
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:edges", key: edge.id }
    });
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: {
        scope: "mem:graph:edge-key",
        key: `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`
      }
    });
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:edge-history", key: edge.id }
    }).catch(() => {});
  }

  // 4. Delete canonical nodes, degrees, name-index & graph membership
  for (const node of matchedNodes) {
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:nodes", key: node.id }
    });
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:node-degree", key: node.id }
    });
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:name-index", key: `${node.type}|${node.name}` }
    });
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:membership", key: node.id }
    }).catch(() => {});
  }

  for (const nodeId of matchedNodeIds) {
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:nodes", key: nodeId }
    });
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:node-degree", key: nodeId }
    });
    await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: "mem:graph:membership", key: nodeId }
    }).catch(() => {});
  }

  // 5. Layer 5 (v0.9.32 #1642): Clean up any orphaned facets referencing deleted nodes or edges
  let deletedFacetsCount = 0;
  try {
    const allFacets = await worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::list",
      payload: { scope: "mem:facets" }
    });
    const targetFacets = (allFacets || []).filter(
      (f) => f && (matchedNodeIds.has(f.targetId) || incidentEdgeIds.has(f.targetId))
    );
    for (const facet of targetFacets) {
      await worker.trigger({
        namespace: III_NAMESPACE,
        function_id: "state::delete",
        payload: { scope: "mem:facets", key: facet.id }
      });
      deletedFacetsCount += 1;
    }
  } catch {}

  // 6. Force rebuild snapshot
  await worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "mem::graph-snapshot-rebuild",
    payload: { force: true }
  });

  const secret = getSecret();
  const after = await queryGraph(secret);

  console.log(
    JSON.stringify(
      {
        status: "deleted",
        deletedNodes: matchedNodes.map((n) => ({ id: n.id, name: n.name, type: n.type })),
        deletedEdgesCount: incidentEdges.length,
        deletedFacetsCount,
        totalStoreNodes: control.nodes,
        totalStoreEdges: control.edges,
        remainingUnlinked: after.unlinked.length
      },
      null,
      2
    )
  );
  process.exit(0);
}

/**
 * One-Shot Maintenance (v2.2):
 * - Incremental Delta Log Inspection & Auto-Heal (mcp-crash.log + daemon logs, 0-token repeat reads)
 * - Env & maxReads: 4096 Self-Patch
 * - Spool Drain + Abandoned Session Sweep (#1645) + Orphaned Index Generation Check (#1256)
 * - Bounded Graph Stats (#1260) + Retrieval Index Auto-Resume + Snapshot Rebuild
 */
async function runHeal(secret) {
  const selfPatches = {
    envLlmProvider: "already_set",
    deprecatedKeysRemoved: "none",
    maxReads4096: "already_patched"
  };

  // 1. Ensure AGENTMEMORY_LLM_PROVIDER=openai & remove deprecated OPENAI_API_KEY_FOR_LLM (#1664)
  const envPath = path.join(AGENTMEMORY_DIR, ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    let modified = false;
    if (!/^AGENTMEMORY_LLM_PROVIDER=/m.test(envContent) && /^OPENAI_API_KEY=/m.test(envContent)) {
      envContent = envContent.replace(/^OPENAI_API_KEY=/m, "AGENTMEMORY_LLM_PROVIDER=openai\nOPENAI_API_KEY=");
      selfPatches.envLlmProvider = "patched_openai";
      modified = true;
    }
    if (/^OPENAI_API_KEY_FOR_LLM=/m.test(envContent)) {
      envContent = envContent.replace(/^OPENAI_API_KEY_FOR_LLM=.*\n?/gm, "");
      selfPatches.deprecatedKeysRemoved = "removed_OPENAI_API_KEY_FOR_LLM";
      modified = true;
    }
    if (modified) {
      fs.writeFileSync(envPath, envContent, "utf8");
    }
  }

  // 2. Ensure maxReads: 4096 & maxBytes: 8MB in dist/index.mjs (survives npm upgrades)
  const distPath = "/usr/local/lib/node_modules/@agentmemory/agentmemory/dist/index.mjs";
  if (fs.existsSync(distPath)) {
    let distContent = fs.readFileSync(distPath, "utf8");
    if (distContent.includes("maxReads: 2048")) {
      distContent = distContent.replace(
        /createGraphIndexReader\(state,\s*\{\s*maxReads:\s*2048,\s*maxBytes:\s*4\s*\*\s*1024\s*\*\s*1024\s*\}\)/g,
        "createGraphIndexReader(state, {\n\t\t\tmaxReads: 4096,\n\t\t\tmaxBytes: 8 * 1024 * 1024\n\t\t})"
      );
      fs.writeFileSync(distPath, distContent, "utf8");
      selfPatches.maxReads4096 = "re_patched_after_upgrade";
    }
  }

  // 3. Incremental Log Delta Check & Self-Heal (#1662, #1674)
  const logInspector = await inspectAndHealLogs(secret);

  // 4. Drain offline capture spool
  const drainRes = await fetch(`${BASE_URL}/agentmemory/capture/drain`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    }
  });
  const drainData = drainRes.ok ? await drainRes.json() : { error: `HTTP ${drainRes.status}` };

  // 5. Check & auto-resume Graph Retrieval Index
  let indexRes = await fetch(`${BASE_URL}/agentmemory/graph/index`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` }
  });
  let indexData = indexRes.ok ? await indexRes.json() : { error: `HTTP ${indexRes.status}` };

  if ((indexData.state === "paused" || indexData.control?.status === "paused") && !indexData.ready) {
    await fetch(`${BASE_URL}/agentmemory/graph/index/resume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ allowLegacyScan: true })
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    indexRes = await fetch(`${BASE_URL}/agentmemory/graph/index`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` }
    });
    indexData = indexRes.ok ? await indexRes.json() : indexData;
  }

  // 6. Trigger v0.9.32 Session Sweep (#1645), Orphan Index Generation Check (#1256), & Bounded Graph Stats (#1260)
  let resourceMaintenance = {
    sessionSweep: "skipped",
    orphanIndexGenerationSweep: "checked_on_boot",
    boundedGraphStats: null
  };
  try {
    const { registerWorker } = await import(III_SDK_PATH);
    const worker = registerWorker(III_WS_URL, {
      workerName: `graph-linker-heal-${Date.now()}`,
      namespace: III_NAMESPACE
    });
    const [sweepRes, orphanMarker, boundedStats] = await Promise.all([
      worker
        .trigger({
          namespace: III_NAMESPACE,
          function_id: "mem::session-sweep",
          payload: {}
        })
        .catch(() => null),
      worker
        .trigger({
          namespace: III_NAMESPACE,
          function_id: "state::get",
          payload: { scope: "mem:idx:bm25", key: "legacy:sweep" }
        })
        .catch(() => null),
      worker
        .trigger({
          namespace: III_NAMESPACE,
          function_id: "mem::graph-stats",
          payload: {}
        })
        .catch(() => null)
    ]);
    if (sweepRes) {
      resourceMaintenance.sessionSweep = {
        scanned: sweepRes.scanned ?? 0,
        abandonedSwept: sweepRes.abandoned ?? 0
      };
    }
    if (orphanMarker) {
      resourceMaintenance.orphanIndexGenerationSweep = orphanMarker;
    }
    if (boundedStats) {
      resourceMaintenance.boundedGraphStats = {
        available: boundedStats.available,
        coverage: boundedStats.coverage,
        totalNodes: boundedStats.totalNodes,
        totalEdges: boundedStats.totalEdges
      };
    }
  } catch {}

  await rebuildSnapshot(secret);
  const graphState = await queryGraph(secret);

  console.log(
    JSON.stringify(
      {
        status: "healed",
        version: "2.2",
        selfPatches,
        logInspector: {
          totalUnreadBytesRead: logInspector.totalUnreadBytesRead,
          skippedUnchangedFiles: logInspector.skippedUnchangedFiles,
          detectedIssues: logInspector.detectedIssues,
          autoHealedActions: logInspector.autoHealedActions
        },
        spoolDrain: drainData.results?.[0] || drainData,
        resourceMaintenance,
        graphIndex: {
          state: indexData.state || indexData.control?.status,
          ready: indexData.ready,
          nodes: indexData.control?.nodes,
          edges: indexData.control?.edges,
          incompleteRecords: indexData.control?.incompleteRecords
        },
        graphViewer: {
          viewNodes: graphState.nodes.length,
          viewEdges: graphState.edges.length,
          unlinkedCount: graphState.unlinked.length,
          sparseWarningActive: graphState.unlinked.length > Math.floor(graphState.nodes.length * 0.1)
        }
      },
      null,
      2
    )
  );
  process.exit(0);
}

async function runBeautify(secret) {
  console.log("🎨 [Beautify] Analyzing graph topology and thematic clusters...");
  const { nodes, edges, unlinked } = await queryGraph(secret);
  const frontAnchors = nodes.slice(0, 20);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const entitiesMap = new Map();
  const rels = [];
  const existingPairSet = new Set(
    edges.map((e) => {
      const s = nodeById.get(e.sourceNodeId);
      const t = nodeById.get(e.targetNodeId);
      return s && t ? `${s.name}|${t.name}` : "";
    })
  );

  // 1. Establish Inter-Cluster Central Backbone Bridges
  for (const bridge of INTER_CLUSTER_BRIDGES) {
    const pair1 = `${bridge.source}|${bridge.target}`;
    const pair2 = `${bridge.target}|${bridge.source}`;
    if (!existingPairSet.has(pair1) && !existingPairSet.has(pair2)) {
      rels.push({
        source: bridge.source,
        sourceType: bridge.sourceType || "concept",
        target: bridge.target,
        targetType: bridge.targetType || "concept",
        type: bridge.type
      });
      existingPairSet.add(pair1);
    }
  }

  // 2. Classify and balance unlinked nodes across front-of-queue domain anchors
  const clusterCounts = {};
  for (const d of THEMATIC_DOMAINS) clusterCounts[d.id] = 0;

  console.log(`🎨 [Beautify] Semantic linking ${unlinked.length} unlinked nodes to front anchors...`);

  for (let i = 0; i < unlinked.length; i++) {
    const node = unlinked[i];
    const domain = classifyNodeDomain(node);
    clusterCounts[domain.id] = (clusterCounts[domain.id] || 0) + 1;

    let targetAnchor = frontAnchors.find(
      (a) => a.name === domain.anchor.name || a.name === domain.subAnchor.name
    );
    if (!targetAnchor || (targetAnchor.name === node.name && targetAnchor.type === node.type)) {
      targetAnchor = pickSemanticAnchor(node, frontAnchors, i).anchor;
    }

    if (targetAnchor && (node.name !== targetAnchor.name || node.type !== targetAnchor.type)) {
      const relType = determineSemanticRelation(node);
      rels.push({
        source: node.name,
        sourceType: node.type,
        target: targetAnchor.name,
        targetType: targetAnchor.type,
        type: relType
      });
    }
  }

  if (rels.length > 0) {
    console.log(`🎨 [Beautify] Injecting ${rels.length} balanced semantic relationships via DIRECT_GRAPH_XML...`);
    const extractRes = await applyDirectXmlLinks(secret, Array.from(entitiesMap.values()), rels);
    console.log(`🎨 [Beautify] Graph extraction completed: +${extractRes.edgesAdded} edges.`);
    await rebuildSnapshot(secret);
  }

  // 3. Multi-pass convergence sweep for any boundary nodes shifted into the 500-node window
  for (let sweep = 0; sweep < 5; sweep++) {
    const current = await queryGraph(secret);
    if (current.unlinked.length === 0) break;
    console.log(`🎨 [Beautify Sweep ${sweep + 1}] Linking ${current.unlinked.length} newly surfaced boundary nodes...`);
    const topAnchors = current.nodes.slice(0, 15).filter((a) => a.degree > 0);
    const sweepRels = [];
    for (let i = 0; i < current.unlinked.length; i++) {
      const u = current.unlinked[i];
      const { anchor, relation } = pickSemanticAnchor(u, topAnchors, i);
      if (anchor && (u.name !== anchor.name || u.type !== anchor.type)) {
        sweepRels.push({
          source: u.name,
          sourceType: u.type,
          target: anchor.name,
          targetType: anchor.type,
          type: relation
        });
      }
    }
    if (!sweepRels.length) break;
    await applyDirectXmlLinks(secret, [], sweepRels);
    await rebuildSnapshot(secret);
  }

  const final = await queryGraph(secret);
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
        version: "2.2",
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
          version: "2.2",
          totalStoreNodes: data.totalNodes,
          totalStoreEdges: data.totalEdges,
          viewNodes: nodes.length,
          viewEdges: edges.length,
          unlinkedCount: unlinked.length,
          sparseWarningActive: unlinked.length > Math.floor(nodes.length * 0.1),
          maxDegree: maxDeg,
          avgDegree: avgDeg,
          edgeTypes,
          frontAnchors: nodes.slice(0, 15).map((n) => ({ idx: n.idx, name: n.name, type: n.type, degree: n.degree })),
          sampleUnlinked: unlinked.slice(0, 15).map((n) => ({ idx: n.idx, name: n.name, type: n.type }))
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === "--delete") {
    await runDelete(args.slice(1));
    return;
  }

  if (mode === "--heal" || mode === "--drain") {
    await runHeal(secret);
    return;
  }

  if (mode === "--logs") {
    const resetCursor = args.includes("--reset-cursor");
    const report = await inspectAndHealLogs(secret, { resetCursor });
    console.log(JSON.stringify(report, null, 2));
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
          frontAnchors: nodes.slice(0, 25).map((n) => ({ idx: n.idx, name: n.name, type: n.type, degree: n.degree })),
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
    let rawJson = args[1];
    if (!rawJson) throw new Error("Usage: graph-linker.mjs --apply '<json_array>' or file path");
    if (fs.existsSync(rawJson)) {
      rawJson = fs.readFileSync(rawJson, "utf8");
    }
    const customLinks = JSON.parse(rawJson);
    const { nodes } = await queryGraph(secret);
    const nodeByName = new Map(nodes.map((n) => [n.name, n]));
    const frontAnchors = nodes.slice(0, 25);
    const frontAnchorNames = new Set(frontAnchors.map((n) => n.name));

    const rels = [];
    for (let i = 0; i < customLinks.length; i++) {
      const item = customLinks[i];
      const sNode = item.sourceType
        ? { name: item.source, type: item.sourceType }
        : nodeByName.get(item.source) || { name: item.source, type: "concept" };
      const tNode = item.targetType
        ? { name: item.target, type: item.targetType }
        : nodeByName.get(item.target) || { name: item.target, type: "concept" };
      const relType = normalizeRelation(item.type || item.relation);

      if (sNode.name === tNode.name) {
        // Same-name entity collision (e.g., Zalo entity -> Zalo library): anchor directly to frontAnchor
        const { anchor } = pickSemanticAnchor(sNode, frontAnchors, i);
        rels.push({
          source: sNode.name,
          sourceType: sNode.type,
          target: anchor.name,
          targetType: anchor.type,
          type: relType === "related_to" ? determineSemanticRelation(sNode) : relType,
          weight: item.weight || 0.9
        });
        continue;
      }

      rels.push({
        source: sNode.name,
        sourceType: sNode.type,
        target: tNode.name,
        targetType: tNode.type,
        type: relType,
        weight: item.weight || 0.9
      });

      // Auto-Anchor Visibility Protection: if neither endpoint is in pageNodes[0..24],
      // attach source to a semantic frontAnchor so the edge is guaranteed to be read within maxReads: 4096.
      if (!frontAnchorNames.has(sNode.name) && !frontAnchorNames.has(tNode.name)) {
        const { anchor, relation } = pickSemanticAnchor(sNode, frontAnchors, i);
        if (anchor && anchor.name !== sNode.name) {
          rels.push({
            source: sNode.name,
            sourceType: sNode.type,
            target: anchor.name,
            targetType: anchor.type,
            type: relation,
            weight: 0.85
          });
        }
      }
    }

    const result = await applyDirectXmlLinks(secret, [], rels);
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
    const anchorWindows = [15, 10, 6];
    for (let pass = 0; pass < anchorWindows.length; pass++) {
      const { nodes, edges, unlinked } = await queryGraph(secret);
      console.log(`[Pass ${pass + 1}] View nodes: ${nodes.length}, View edges: ${edges.length}, Unlinked: ${unlinked.length}`);
      if (unlinked.length === 0) break;

      const windowSize = anchorWindows[pass];
      const frontAnchors = nodes.slice(0, windowSize);
      const rels = [];

      for (let i = 0; i < unlinked.length; i++) {
        const u = unlinked[i];
        const { anchor, relation } = pickSemanticAnchor(u, frontAnchors, i);
        if (anchor && (u.name !== anchor.name || u.type !== anchor.type)) {
          rels.push({
            source: u.name,
            sourceType: u.type,
            target: anchor.name,
            targetType: anchor.type,
            type: relation
          });
        }
      }

      const res = await applyDirectXmlLinks(secret, [], rels);
      console.log(`[Pass ${pass + 1}] Linked +${res.edgesAdded} edges (0 external LLM tokens).`);
    }

    await rebuildSnapshot(secret);
    const finalState = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          status: "completed",
          version: "2.2",
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

  throw new Error(
    `Unknown flag: ${mode}. Use --status, --auto, --beautify, --dump, --apply, --delete, --heal, or --logs.`
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
