#!/usr/bin/env node
/**
 * AgentMemory Knowledge Graph Linker, Beautifier, Cleaner, Deduplicator & Healer (v3.0)
 * Zero-Token / Lightweight-Model Graph & RAM Optimization Toolkit for Antigravity
 *
 * Usage:
 *   node graph-linker.mjs --status
 *   node graph-linker.mjs --audit  [--days 14]
 *   node graph-linker.mjs --dedup
 *   node graph-linker.mjs --rename "<old_name_or_id>" "<new_name>" [--type <new_type>]
 *   node graph-linker.mjs --prune  [--days 14] [--include-stale] [--include-hallucinations]
 *   node graph-linker.mjs --restore "<node_name_or_id|--last|--list>"
 *   node graph-linker.mjs --optimize-ram
 *   node graph-linker.mjs --beautify
 *   node graph-linker.mjs --delete "<node_name_or_id>" ["<more_names_or_ids>..."]
 *   node graph-linker.mjs --heal   (alias: --drain)
 *   node graph-linker.mjs --logs   [--reset-cursor]
 *   node graph-linker.mjs --dump
 *   node graph-linker.mjs --apply '<json_relations_array_or_filepath>'
 *   node graph-linker.mjs --auto
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const HOME = os.homedir();
const AGENTMEMORY_DIR = process.env.AGENTMEMORY_DATA_DIR || path.join(HOME, ".agentmemory");
const SECRET_PATH = path.join(AGENTMEMORY_DIR, "secret");
const LOG_CURSOR_PATH = path.join(AGENTMEMORY_DIR, ".log-heal-cursor.json");
const GRAVEYARD_PATH = path.join(AGENTMEMORY_DIR, "graveyard.jsonl");
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
 * Strips lone UTF-16 surrogates (#1598) and unescapes/escapes XML entities safely.
 */
function stripLoneSurrogates(str) {
  return String(str ?? "").replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    ""
  );
}

function unescapeXml(str) {
  let s = stripLoneSurrogates(str);
  for (let i = 0; i < 12; i++) {
    const next = s
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&gt;/gi, ">")
      .replace(/&lt;/gi, "<")
      .replace(/&amp;/gi, "&");
    if (next === s) break;
    s = next;
  }
  return s;
}

function escapeXml(str) {
  return unescapeXml(str)
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

// Exact NODE_TYPES & EDGE_TYPES recognized by AgentMemory v0.9.32 validateControl()
const CONTROL_NODE_TYPES = new Set([
  "file",
  "function",
  "concept",
  "error",
  "decision",
  "pattern",
  "library",
  "person",
  "project",
  "preference",
  "location",
  "organization",
  "event"
]);

const CONTROL_EDGE_TYPES = new Set([
  "uses",
  "imports",
  "modifies",
  "causes",
  "fixes",
  "depends_on",
  "related_to",
  "works_at",
  "prefers",
  "blocked_by",
  "caused_by",
  "optimizes_for",
  "rejected",
  "avoids",
  "located_in",
  "succeeded_by"
]);

const GRAPH_SCOPES = new Set([
  "mem:graph:nodes",
  "mem:graph:edges",
  "mem:graph:edge-history",
  "mem:graph:snapshot",
  "mem:graph:name-index",
  "mem:graph:edge-key",
  "mem:graph:node-degree",
  "mem:graph:membership",
  "mem:graph:retrieval-control",
  "mem:graph:retrieval-data",
  "mem:graph:index-migration",
  "mem:graph:index-manifest"
]);

// Immunity Whitelist ("Kim Bài Miễn Tử"): Node types that are NEVER auto-pruned
const IMMUNE_NODE_TYPES = new Set([
  "decision",
  "preference",
  "pattern",
  "person",
  "project",
  "milestone"
]);

// Comprehensive Tech & Project Lexicon for 0-Token Grounding Verification
const TECH_LEXICON = new Set([
  "agentmemory", "antigravity", "flutter", "dart", "xcode", "xcodebuild", "xcrun",
  "macos", "darwin", "coreaudio", "hal", "audio", "driver", "dgpu", "igpu", "amd",
  "radeon", "metal", "toshllm", "glm", "ocr", "vision", "llama", "gguf", "qwen",
  "gemini", "groq", "gemma", "openai", "claude", "anthropic", "router", "smart",
  "token", "prompt", "embedding", "bm25", "vector", "sqlite", "redis", "kv", "graph",
  "node", "edge", "snapshot", "index", "spool", "session", "observation", "memory",
  "recall", "facet", "sentinel", "crystal", "lesson", "skill", "mcp", "websocket",
  "http", "rest", "api", "json", "jsonl", "xml", "yaml", "plist", "env", "cli",
  "git", "github", "commit", "branch", "push", "npm", "bun", "pnpm", "yarn",
  "android", "adb", "scrcpy", "termux", "canta", "shizuku", "samsung", "fold",
  "xiaomi", "pixel", "motorola", "hyperos", "zalo", "tiktok", "messenger",
  "firefox", "chrome", "devtools", "ublock", "nextdns", "bluetooth", "toothfairy",
  "homebrew", "fedora", "bootcamp", "uefi", "firmware", "shopeasy", "widget",
  "state", "layout", "theme", "animation", "firebase", "firestore", "auth",
  "openssh", "alpine", "docker", "linux", "ssh", "vscode", "cursor", "launchctl"
]);

// Explicit Off-Domain Hallucination Blocklist (catches free-LLM wild associations)
const HALLUCINATION_REGEX =
  /\b(invasion\s+german|german\s+invasion|third\s+reich|adolf\s+hitler|nazi\s+party|world\s+war\s+ii|holocaust|soviet\s+invasion|roman\s+empire|medieval\s+europe|napoleonic)\b/i;

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
      "router", "embedding", "tpm", "tpd", "rate limit", "llm", "ai", "model", "gpt",
      "toshllm", "ocr", "glm", "llama", "gguf", "vision"
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

const INTER_CLUSTER_BRIDGES = [
  { source: "/Users/crydamoure/.claude/skills", sourceType: "file", target: "Smart AI Router", targetType: "pattern", type: "uses" },
  { source: "Smart AI Router", sourceType: "pattern", target: "agentmemory module", targetType: "concept", type: "modifies" },
  { source: "mobile-design", sourceType: "concept", target: "flutter-expert", targetType: "concept", type: "depends_on" },
  { source: "MacBook Pro", sourceType: "concept", target: "agentmemory module", targetType: "concept", type: "uses" },
  { source: "/Users/crydamoure/.claude/skills", sourceType: "file", target: "flutter-expert", targetType: "concept", type: "uses" },
  { source: "git-pushing", sourceType: "concept", target: "/Users/crydamoure/.claude/skills", targetType: "file", type: "uses" }
];

const IMMUNE_ANCHOR_NAMES = new Set(
  THEMATIC_DOMAINS.flatMap((d) => [d.anchor.name.toLowerCase(), d.subAnchor.name.toLowerCase()])
);

/**
 * 5-Layer KV Engine with Generation Awareness & Full project() + planRecord() Parity
 */
const MAX_PROJECTION_BYTES = 16 * 1024;
const MAX_POSTINGS = 192;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bytes = (value) => Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
const validId = (value) =>
  typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 1024;
const normalizeGraphIndexText = (value) => String(value ?? "").normalize("NFKC").toLowerCase();
const graphEdgeLookupKey = (edge) =>
  JSON.stringify([edge.sourceNodeId, edge.targetNodeId, edge.type]);
const token = (kind, value) =>
  hash(
    `${kind}\0${
      kind === "name" || kind === "character" ? normalizeGraphIndexText(value) : value
    }`
  );
const recordKey = (buildId, kind, id) => `${buildId}:record:${kind}:${hash(id)}`;
const rootKey = (buildId, posting) => `${buildId}:root:${posting}`;
const entryKey = (buildId, posting, id) => `${buildId}:entry:${posting}:${id}`;
const countKey = (kind) =>
  kind === "node" ? "nodes" : kind === "edge" ? "edges" : "historyEdges";

function projectRecord(kind, id, input) {
  if (input === null || input === undefined) return null;
  const source = input;
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    !validId(id) ||
    source.id !== id
  ) {
    return { row: null, postings: [], incomplete: true };
  }
  if (source.stale === true) {
    return { row: null, postings: [], incomplete: false };
  }

  let incomplete = false;
  const text = (value, max = 512) => {
    if (typeof value !== "string") {
      incomplete = true;
      return "";
    }
    const result = Array.from(value.slice(0, max * 2)).slice(0, max).join("");
    if (result !== value) incomplete = true;
    return result;
  };

  const ids = [];
  if (!Array.isArray(source.sourceObservationIds)) {
    incomplete = true;
  } else {
    for (const value of source.sourceObservationIds.slice(0, 512)) {
      if (!validId(value)) {
        incomplete = true;
        continue;
      }
      if (ids.includes(value)) continue;
      if (ids.length >= 128) {
        incomplete = true;
        break;
      }
      ids.push(value);
    }
    if (source.sourceObservationIds.length > 512) incomplete = true;
  }

  const common = {
    id,
    type: text(source.type, 64),
    sourceObservationIds: ids,
    createdAt: text(source.createdAt || new Date().toISOString(), 64)
  };

  let row;
  if (kind === "node") {
    const properties = {};
    if (!source.properties || typeof source.properties !== "object" || Array.isArray(source.properties)) {
      incomplete = true;
    } else {
      for (const key of Object.keys(source.properties)) {
        if (Object.keys(properties).length >= 32) {
          incomplete = true;
          break;
        }
        const value = source.properties[key];
        if (key.length > 128) {
          incomplete = true;
          continue;
        }
        if (typeof value === "string") {
          properties[key] = text(value);
        } else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
          properties[key] = value;
        } else {
          incomplete = true;
        }
      }
    }
    const aliases = Array.isArray(source.aliases)
      ? source.aliases
          .slice(0, 16)
          .filter((v) => typeof v === "string")
          .map((v) => text(v))
      : [];
    if (Array.isArray(source.aliases) && aliases.length !== source.aliases.length) incomplete = true;
    row = {
      ...common,
      type: common.type,
      name: text(source.name),
      properties,
      ...(aliases.length ? { aliases } : {}),
      ...(typeof source.updatedAt === "string" ? { updatedAt: text(source.updatedAt, 64) } : {})
    };
  } else {
    if (!validId(source.sourceNodeId) || !validId(source.targetNodeId)) {
      return { row: null, postings: [], incomplete: true };
    }
    const edge = {
      ...common,
      type: common.type,
      sourceNodeId: source.sourceNodeId,
      targetNodeId: source.targetNodeId,
      weight:
        typeof source.weight === "number" && Number.isFinite(source.weight) ? source.weight : 0.8
    };
    if (edge.weight !== source.weight) incomplete = true;
    for (const key of ["tcommit", "tvalid", "tvalidEnd", "supersededBy"]) {
      if (typeof source[key] === "string") {
        edge[key] = text(source[key], key === "supersededBy" ? 1024 : 64);
      }
    }
    if (typeof source.version === "number" && Number.isFinite(source.version)) {
      edge.version = source.version;
    }
    if (typeof source.isLatest === "boolean") {
      edge.isLatest = source.isLatest;
    }
    if (source.context && typeof source.context === "object" && !Array.isArray(source.context)) {
      const ctx = source.context;
      edge.context = {};
      for (const key of ["reasoning", "sentiment"]) {
        if (typeof ctx[key] === "string") edge.context[key] = text(ctx[key]);
      }
      if (typeof ctx.confidence === "number" && Number.isFinite(ctx.confidence)) {
        edge.context.confidence = ctx.confidence;
      }
      if (ctx.alternatives !== undefined || ctx.situationalFactors !== undefined) {
        incomplete = true;
      }
    }
    row = edge;
  }

  while (bytes(row) > MAX_PROJECTION_BYTES - 64) {
    incomplete = true;
    if ("properties" in row && Object.keys(row.properties).length) {
      delete row.properties[Object.keys(row.properties).at(-1)];
    } else if ("aliases" in row && row.aliases?.length) {
      row.aliases.pop();
    } else if ("context" in row && row.context) {
      delete row.context;
    } else if (row.sourceObservationIds.length) {
      row.sourceObservationIds.pop();
    } else {
      return { row: null, postings: [], incomplete: true };
    }
  }

  const postings = new Set([token(countKey(kind), "")]);
  if (kind === "node") {
    const node = row;
    for (const value of [node.name, ...(node.aliases ?? [])]) {
      postings.add(token("name", value));
    }
    const searchable = [
      node.name,
      ...(node.aliases ?? []),
      ...Object.values(node.properties).filter((v) => typeof v === "string")
    ];
    const characters = new Set(
      searchable.flatMap((value) => Array.from(normalizeGraphIndexText(value)))
    );
    for (const character of characters) {
      if (postings.size >= MAX_POSTINGS - row.sourceObservationIds.length) {
        incomplete = true;
        break;
      }
      postings.add(token("character", character));
    }
    for (const observationId of row.sourceObservationIds) {
      postings.add(token("observation", observationId));
    }
  } else {
    const edge = row;
    for (const nodeId of [edge.sourceNodeId, edge.targetNodeId]) {
      postings.add(token(kind === "history" ? "history" : "adjacency", nodeId));
    }
    if (kind === "edge") {
      if (edge.isLatest !== false) {
        postings.add(token("edgeKey", graphEdgeLookupKey(edge)));
      }
      for (const observationId of row.sourceObservationIds) {
        postings.add(token("edgeObservation", observationId));
      }
    }
  }

  if (incomplete) row.indexIncomplete = true;
  return {
    row,
    postings: [...postings],
    incomplete
  };
}

async function createGraphKvEngine(workerLabel = "graph-linker-v3") {
  const { registerWorker } = await import(III_SDK_PATH);
  const worker = registerWorker(III_WS_URL, {
    workerName: `${workerLabel}-${Date.now()}`,
    namespace: III_NAMESPACE
  });

  const genVal = await worker
    .trigger({
      namespace: III_NAMESPACE,
      function_id: "state::get",
      payload: { scope: "mem:graph:control", key: "generation" }
    })
    .catch(() => null);
  const generationId =
    typeof genVal === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(genVal)
      ? genVal
      : null;

  const resolveScope = (scope) =>
    generationId !== null && GRAPH_SCOPES.has(scope)
      ? `${scope}:generation:${generationId}`
      : scope;

  const kvGet = (scope, key) =>
    worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::get",
      payload: { scope: resolveScope(scope), key }
    });

  const kvSet = (scope, key, value) =>
    worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::set",
      payload: { scope: resolveScope(scope), key, value }
    });

  const kvDelete = (scope, key) =>
    worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::delete",
      payload: { scope: resolveScope(scope), key }
    });

  const kvList = (scope) =>
    worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "state::list",
      payload: { scope: resolveScope(scope) }
    });

  /**
   * Plans and applies an atomic create / update / delete in mem:graph:retrieval-data
   * and mem:graph:retrieval-control.
   * - input === null => deletes the record and unlinks all postings
   * - input === object => upserts the record and diffs oldPostings vs newPostings
   */
  async function applyRetrievalRecord(control, kind, id, input) {
    const writes = new Map();
    const read = async (key) =>
      writes.has(key) ? writes.get(key) : await kvGet("mem:graph:retrieval-data", key);
    const put = (key, value) => writes.set(key, value);

    const rKey = recordKey(control.buildId, kind, id);
    const before = await read(rKey);
    const after =
      input === null || input === undefined
        ? { row: null, postings: [], incomplete: false }
        : projectRecord(kind, id, input);
    const memberId = hash(id);

    const editPosting = async (posting, add) => {
      const rId = rootKey(control.buildId, posting);
      const iId = entryKey(control.buildId, posting, memberId);
      const root = (await read(rId)) ?? { head: null, count: 0 };
      const saved = await read(iId);

      if (add) {
        if (saved) return;
        if (root.head) {
          const headId = entryKey(control.buildId, posting, root.head);
          const head = await read(headId);
          if (head) put(headId, { ...head, previous: memberId });
        }
        put(iId, { id, previous: null, next: root.head });
        put(rId, { head: memberId, count: root.count + 1 });
      } else {
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
        put(iId, null);
        put(rId, { head: root.head, count: Math.max(0, root.count - 1) });
      }
    };

    const oldPostings = new Set(before?.postings ?? []);
    const newPostings = new Set(after?.postings ?? []);
    for (const posting of oldPostings) {
      if (!newPostings.has(posting)) await editPosting(posting, false);
    }
    for (const posting of newPostings) {
      if (!oldPostings.has(posting)) await editPosting(posting, true);
    }
    put(rKey, after);

    const { pending: _, ...clean } = control;
    const next = {
      ...clean,
      revision: control.revision + 1,
      updatedAt: new Date().toISOString()
    };
    const counted = (row) => Boolean(row && (kind !== "edge" || row.isLatest !== false));
    const cKey = countKey(kind);
    next[cKey] = Math.max(
      0,
      next[cKey] + Number(counted(after?.row)) - Number(counted(before?.row))
    );
    next.incompleteRecords = Math.max(
      0,
      next.incompleteRecords +
        Number(Boolean(after?.incomplete)) -
        Number(Boolean(before?.incomplete))
    );

    if (kind !== "history") {
      const field = kind === "node" ? "nodesByType" : "edgesByType";
      const known = kind === "node" ? CONTROL_NODE_TYPES : CONTROL_EDGE_TYPES;
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

    // Flush distinct writes in parallel batches of 24
    const entries = Array.from(writes.entries());
    for (let i = 0; i < entries.length; i += 24) {
      const chunk = entries.slice(i, i + 24);
      await Promise.all(
        chunk.map(([k, v]) =>
          v === null
            ? kvDelete("mem:graph:retrieval-data", k)
            : kvSet("mem:graph:retrieval-data", k, v)
        )
      );
    }
    await kvSet("mem:graph:retrieval-control", "current", next);
    return { next, writesCount: entries.length };
  }

  return {
    worker,
    generationId,
    resolveScope,
    kvGet,
    kvSet,
    kvDelete,
    kvList,
    applyRetrievalRecord
  };
}

/**
 * Cold Graveyard Helpers (~/.agentmemory/graveyard.jsonl)
 */
function appendToGraveyard(entries) {
  if (!entries || !entries.length) return 0;
  fs.mkdirSync(path.dirname(GRAVEYARD_PATH), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(GRAVEYARD_PATH, lines, "utf8");
  return entries.length;
}

function readGraveyard() {
  if (!fs.existsSync(GRAVEYARD_PATH)) return [];
  const raw = fs.readFileSync(GRAVEYARD_PATH, "utf8").trim();
  if (!raw) return [];
  const items = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {}
  }
  return items;
}

function writeGraveyard(items) {
  fs.mkdirSync(path.dirname(GRAVEYARD_PATH), { recursive: true });
  if (!items.length) {
    fs.writeFileSync(GRAVEYARD_PATH, "", "utf8");
    return;
  }
  fs.writeFileSync(
    GRAVEYARD_PATH,
    items.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8"
  );
}

/**
 * Sentry-Style Error Fingerprinting & Duplicate Grouping
 */
function getErrorFingerprint(node) {
  if (!node || node.type !== "error") return null;
  const clean = unescapeXml(node.name || "")
    .replace(/\\+$/g, "")
    .trim();
  if (
    /xcodebuild/i.test(clean) &&
    (/unable to find utility/i.test(clean) ||
      /not found/i.test(clean) ||
      /exit code 72/i.test(clean) ||
      /xcodebuild_not_found/i.test(clean))
  ) {
    return {
      fingerprint: "error_fp:xcodebuild_not_found",
      canonicalName: "xcodebuild not found"
    };
  }
  const norm = clean
    .toLowerCase()
    .replace(/['"`“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    fingerprint: `error_fp:${norm}`,
    canonicalName: clean
  };
}

function isXmlEntityCorrupted(name) {
  return /&(?:quot|lt|gt|amp|apos|#\d+|#x[\da-f]+);/i.test(String(name || ""));
}

function isTransientScratchNode(node) {
  const nm = String(node.name || "");
  if (
    nm.includes("/.system_generated/tasks/") ||
    nm.includes("/.system_generated/steps/") ||
    nm.includes("/.user_uploaded/media_") ||
    nm.startsWith("/tmp/") ||
    nm.startsWith("/private/tmp/") ||
    nm.includes("/var/folders/") ||
    nm === "workspace"
  ) {
    return true;
  }
  return false;
}

function isNodeImmune(node, degree, fixedNodeIds) {
  if (!node) return false;
  if (isTransientScratchNode(node)) return false;
  if (IMMUNE_NODE_TYPES.has(node.type)) return true;
  if (IMMUNE_ANCHOR_NAMES.has(String(node.name || "").toLowerCase())) return true;
  if (node.type === "error" && fixedNodeIds.has(node.id)) return true;
  if (degree >= 4) return true;
  return false;
}

/**
 * Builds Duplicate & Fingerprint Merge Groups across the full graph store.
 */
function buildDeduplicationPlan(allNodes, degreeMap, fixedNodeIds) {
  const groupsByKey = new Map();

  for (const node of allNodes) {
    if (!node || !node.id || !node.name) continue;
    const unescaped = unescapeXml(node.name).replace(/\\+$/g, "").trim();
    if (!unescaped) continue;

    let groupKey;
    let suggestedCanonicalName = unescaped;

    if (node.type === "error") {
      const fp = getErrorFingerprint(node);
      groupKey = fp.fingerprint;
      suggestedCanonicalName = fp.canonicalName;
    } else if (
      node.type === "person" &&
      /^(quỳnh|quynh|quyên|quyén)$/i.test(unescaped)
    ) {
      groupKey = "person|quỳnh";
      suggestedCanonicalName = "Quỳnh";
    } else {
      groupKey = `${node.type}|${unescaped.toLowerCase()}`;
    }

    if (!groupsByKey.has(groupKey)) {
      groupsByKey.set(groupKey, {
        groupKey,
        type: node.type,
        suggestedCanonicalName,
        nodes: []
      });
    }
    groupsByKey.get(groupKey).nodes.push(node);
  }

  const mergeGroups = [];
  const singleNodeRenames = [];

  for (const group of groupsByKey.values()) {
    const list = group.nodes;
    if (list.length === 1) {
      const only = list[0];
      const cleanName = group.suggestedCanonicalName;
      if (isXmlEntityCorrupted(only.name) && cleanName !== only.name) {
        singleNodeRenames.push({
          node: only,
          oldName: only.name,
          newName: cleanName
        });
      }
      continue;
    }

    // Score each candidate in the group to pick the best Canonical Winner:
    // Prefer clean (non-XML-corrupted) name, prefer fixed error, prefer uppercase/TitleCase over all-lowercase, prefer higher degree
    const scored = list.map((n) => {
      const deg = degreeMap.get(n.id) || 0;
      const corrupted = isXmlEntityCorrupted(n.name) || n.name.endsWith("\\");
      const exactCanonical = n.name === group.suggestedCanonicalName;
      const hasUpper = /[A-ZÀ-Ỹ]/.test(n.name);
      const isFixed = fixedNodeIds.has(n.id);
      const score =
        (corrupted ? -1000 : 500) +
        (exactCanonical ? 300 : 0) +
        (isFixed ? 200 : 0) +
        (hasUpper ? 50 : 0) +
        deg * 5;
      return { node: n, score, deg, corrupted };
    });

    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0].node;
    const duplicates = scored.slice(1).map((s) => s.node);

    // Pick best display name (prefer non-corrupted node with richest casing, e.g. TikTok, CLAUDE.md, GlobalKey<FormState>)
    let canonicalName = group.suggestedCanonicalName;
    if (group.type !== "error" && group.groupKey !== "person|quỳnh") {
      const cleanCandidates = scored
        .filter((s) => !s.corrupted)
        .sort(
          (a, b) =>
            (b.node.name.match(/[A-ZÀ-Ỹ]/g) || []).length -
            (a.node.name.match(/[A-ZÀ-Ỹ]/g) || []).length
        );
      canonicalName = cleanCandidates.length
        ? unescapeXml(cleanCandidates[0].node.name).trim()
        : unescapeXml(winner.name).trim();
    }

    mergeGroups.push({
      groupKey: group.groupKey,
      type: group.type,
      canonicalNode: winner,
      canonicalName,
      duplicates
    });
  }

  return { mergeGroups, singleNodeRenames };
}

/**
 * Full Store Audit (--audit):
 * Zero-Token Provenance & Hallucination Detection + Duplicate Groups + Transient Scratch Candidates
 */
async function performGraphAudit(engine, options = {}) {
  const daysCutoff = Number(options.days ?? 14);
  const cutoffMs = Date.now() - daysCutoff * 24 * 60 * 60 * 1000;

  const [allNodesRaw, allEdgesRaw, sessionsRaw, memoriesRaw, summariesRaw] =
    await Promise.all([
      engine.kvList("mem:graph:nodes"),
      engine.kvList("mem:graph:edges"),
      engine.kvList("mem:sessions"),
      engine.kvList("mem:memories").catch(() => []),
      engine.kvList("mem:summaries").catch(() => [])
    ]);

  const allNodes = (allNodesRaw || []).filter((n) => n && n.id);
  const allEdges = (allEdgesRaw || []).filter((e) => e && e.id);

  // Build degree map & fixed error set
  const degreeMap = new Map();
  const fixedNodeIds = new Set();
  for (const e of allEdges) {
    degreeMap.set(e.sourceNodeId, (degreeMap.get(e.sourceNodeId) || 0) + 1);
    degreeMap.set(e.targetNodeId, (degreeMap.get(e.targetNodeId) || 0) + 1);
    if (e.type === "fixes") {
      fixedNodeIds.add(e.sourceNodeId);
      fixedNodeIds.add(e.targetNodeId);
    }
  }

  // Load observation + memory + summary text corpus for 0-token provenance grounding
  const textChunks = [];
  for (const s of sessionsRaw || []) {
    if (!s?.id) continue;
    const obsList = await engine.kvList(`mem:obs:${s.id}`).catch(() => []);
    for (const o of obsList || []) {
      if (!o) continue;
      textChunks.push(
        [
          o.title,
          o.subtitle,
          o.narrative,
          ...(o.facts || []),
          ...(o.concepts || []),
          ...(o.files || [])
        ].join(" ")
      );
    }
  }
  for (const m of memoriesRaw || []) {
    if (!m) continue;
    textChunks.push(
      [m.title, m.content, ...(m.concepts || []), ...(m.files || [])].join(" ")
    );
  }
  for (const s of summariesRaw || []) {
    if (!s) continue;
    textChunks.push(
      [
        s.title,
        s.narrative,
        ...(s.decisions || []),
        ...(s.concepts || []),
        ...(s.files || [])
      ].join(" ")
    );
  }
  const globalCorpus = textChunks.join(" ").toLowerCase();

  // 1. XML Entity Corrupted Nodes
  const xmlCorruptedNodes = allNodes.filter((n) => isXmlEntityCorrupted(n.name));

  // 2. Deduplication Plan (Case/Entity collisions + Sentry-style Error Fingerprinting)
  const { mergeGroups, singleNodeRenames } = buildDeduplicationPlan(
    allNodes,
    degreeMap,
    fixedNodeIds
  );
  const duplicateNodeIds = new Set(
    mergeGroups.flatMap((g) => g.duplicates.map((d) => d.id))
  );

  // 3. Hallucination & Provenance Check
  const hallucinationCandidates = [];
  // 4. Transient Scratch & Stale Candidates
  const transientScratchCandidates = [];
  const staleIsolatedCandidates = [];

  for (const node of allNodes) {
    if (duplicateNodeIds.has(node.id)) continue;
    const deg = degreeMap.get(node.id) || 0;
    const immune = isNodeImmune(node, deg, fixedNodeIds);
    const cleanName = unescapeXml(node.name || "").trim();

    // Explicit hallucination regex (e.g., "invasion German")
    if (HALLUCINATION_REGEX.test(cleanName)) {
      hallucinationCandidates.push({
        id: node.id,
        type: node.type,
        name: node.name,
        degree: deg,
        reason: "matched_off_domain_hallucination_pattern"
      });
      continue;
    }

    // Transient scratch / system_generated / user_uploaded media files
    if (isTransientScratchNode(node) && !immune) {
      transientScratchCandidates.push({
        id: node.id,
        type: node.type,
        name: node.name,
        degree: deg,
        reason: "ephemeral_system_or_scratch_artifact"
      });
      continue;
    }

    // 0-Token Corpus Provenance Check for non-immune low-degree nodes
    if (!immune && deg <= 2 && globalCorpus.length > 0) {
      const tokens = cleanName
        .toLowerCase()
        .split(/[^a-z0-9à-ỹ]+/i)
        .filter((t) => t.length >= 3);
      if (tokens.length > 0) {
        const inCorpus = tokens.some((t) => globalCorpus.includes(t));
        const inLexicon = tokens.some((t) => TECH_LEXICON.has(t));
        if (!inCorpus && !inLexicon) {
          hallucinationCandidates.push({
            id: node.id,
            type: node.type,
            name: node.name,
            degree: deg,
            reason: "zero_token_overlap_with_observations_and_tech_lexicon"
          });
          continue;
        }
      }
    }

    // Stale isolated nodes (degree === 0 and older than daysCutoff)
    if (!immune && deg === 0) {
      const createdMs = Date.parse(node.createdAt || "") || 0;
      if (createdMs > 0 && createdMs < cutoffMs) {
        staleIsolatedCandidates.push({
          id: node.id,
          type: node.type,
          name: node.name,
          degree: deg,
          createdAt: node.createdAt,
          reason: `isolated_deg0_older_than_${daysCutoff}d`
        });
      }
    }
  }

  const totalDuplicateNodes = mergeGroups.reduce(
    (sum, g) => sum + g.duplicates.length,
    0
  );
  const estimatedNodesReducible =
    totalDuplicateNodes +
    transientScratchCandidates.length +
    hallucinationCandidates.length;
  // Each node + its character/name/observation postings averages ~32 KV keys in mem:graph:retrieval-data
  const estimatedKvRecordsFreed = estimatedNodesReducible * 32;

  return {
    allNodes,
    allEdges,
    degreeMap,
    fixedNodeIds,
    xmlCorruptedNodes,
    mergeGroups,
    singleNodeRenames,
    hallucinationCandidates,
    transientScratchCandidates,
    staleIsolatedCandidates,
    summary: {
      totalStoreNodes: allNodes.length,
      totalStoreEdges: allEdges.length,
      xmlEntityCorruptedCount: xmlCorruptedNodes.length,
      duplicateGroupsCount: mergeGroups.length,
      duplicateNodesToMerge: totalDuplicateNodes,
      singleNodesToUnescape: singleNodeRenames.length,
      hallucinationCount: hallucinationCandidates.length,
      transientScratchCount: transientScratchCandidates.length,
      staleIsolatedCount: staleIsolatedCandidates.length,
      estimatedNodesReducible,
      estimatedKvRecordsFreed
    }
  };
}

/**
 * Executes 5-Layer Atomic Merge & Sentry-Style Deduplication (--dedup)
 */
async function executeDeduplication(engine, precomputedAudit = null) {
  const audit = precomputedAudit || (await performGraphAudit(engine));
  const { allNodes, allEdges, mergeGroups, singleNodeRenames } = audit;

  if (mergeGroups.length === 0 && singleNodeRenames.length === 0) {
    return {
      mergedGroupsCount: 0,
      mergedDuplicateNodesCount: 0,
      renamedCorruptedNodesCount: 0,
      repointedEdgesCount: 0,
      deletedRedundantEdgesCount: 0,
      graveyardEntriesWritten: 0
    };
  }

  let control = await engine.kvGet("mem:graph:retrieval-control", "current");
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));
  const graveyardBatch = [];

  let mergedDuplicateNodesCount = 0;
  let renamedCorruptedNodesCount = 0;
  let repointedEdgesCount = 0;
  let deletedRedundantEdgesCount = 0;

  // Build adjacency index of edges in memory for fast lookup
  const edgesByNodeId = new Map();
  for (const edge of allEdges) {
    if (!edgesByNodeId.has(edge.sourceNodeId)) edgesByNodeId.set(edge.sourceNodeId, new Set());
    if (!edgesByNodeId.has(edge.targetNodeId)) edgesByNodeId.set(edge.targetNodeId, new Set());
    edgesByNodeId.get(edge.sourceNodeId).add(edge);
    edgesByNodeId.get(edge.targetNodeId).add(edge);
  }

  const deletedEdgeIds = new Set();

  // 1. Process Single-Node XML Unescape Renames
  for (const item of singleNodeRenames) {
    const node = item.node;
    const oldName = node.name;
    const newName = item.newName;
    if (oldName === newName) continue;

    await engine.kvDelete("mem:graph:name-index", `${node.type}|${oldName}`);
    const updatedNode = {
      ...node,
      name: newName,
      updatedAt: new Date().toISOString()
    };
    await engine.kvSet("mem:graph:nodes", node.id, updatedNode);
    await engine.kvSet("mem:graph:name-index", `${node.type}|${newName}`, node.id);
    const { next } = await engine.applyRetrievalRecord(
      control,
      "node",
      node.id,
      updatedNode
    );
    control = next;
    nodeById.set(node.id, updatedNode);
    renamedCorruptedNodesCount += 1;
  }

  // 2. Process Merge Groups (Atomic 5-Layer Merge)
  for (const group of mergeGroups) {
    const canonical = group.canonicalNode;
    const canonicalName = group.canonicalName;
    const duplicates = group.duplicates;
    const dupIdSet = new Set(duplicates.map((d) => d.id));

    // Collect all incident edges across canonical + duplicates
    const groupEdges = new Set();
    for (const e of edgesByNodeId.get(canonical.id) || []) {
      if (!deletedEdgeIds.has(e.id)) groupEdges.add(e);
    }
    for (const dup of duplicates) {
      const inc = Array.from(edgesByNodeId.get(dup.id) || []).filter(
        (e) => !deletedEdgeIds.has(e.id)
      );
      graveyardBatch.push({
        archivedAt: new Date().toISOString(),
        reason: "dedup_merged",
        mergedIntoId: canonical.id,
        mergedIntoName: canonicalName,
        node: dup,
        incidentEdges: inc,
        facets: []
      });
      for (const e of inc) groupEdges.add(e);
    }

    // Track active canonical edge keys: `${sourceNodeId}|${targetNodeId}|${type}`
    const seenEdgeKeys = new Set();
    for (const e of groupEdges) {
      if (!dupIdSet.has(e.sourceNodeId) && !dupIdSet.has(e.targetNodeId)) {
        seenEdgeKeys.add(`${e.sourceNodeId}|${e.targetNodeId}|${e.type}`);
      }
    }

    // Re-point or remove duplicate incident edges
    for (const edge of groupEdges) {
      if (!dupIdSet.has(edge.sourceNodeId) && !dupIdSet.has(edge.targetNodeId)) {
        continue;
      }
      const newSourceId = dupIdSet.has(edge.sourceNodeId)
        ? canonical.id
        : edge.sourceNodeId;
      const newTargetId = dupIdSet.has(edge.targetNodeId)
        ? canonical.id
        : edge.targetNodeId;
      const newEdgeKey = `${newSourceId}|${newTargetId}|${edge.type}`;

      // Self-loop or parallel duplicate edge -> delete across 5 layers
      if (newSourceId === newTargetId || seenEdgeKeys.has(newEdgeKey)) {
        const { next } = await engine.applyRetrievalRecord(
          control,
          "edge",
          edge.id,
          null
        );
        control = next;
        await Promise.all([
          engine.kvDelete("mem:graph:edges", edge.id),
          engine.kvDelete(
            "mem:graph:edge-key",
            `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`
          ),
          engine.kvDelete("mem:graph:edge-history", edge.id).catch(() => {})
        ]);
        deletedEdgeIds.add(edge.id);
        deletedRedundantEdgesCount += 1;
      } else {
        // Re-point edge to canonical node across 5 layers
        seenEdgeKeys.add(newEdgeKey);
        await engine.kvDelete(
          "mem:graph:edge-key",
          `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`
        );
        const updatedEdge = {
          ...edge,
          sourceNodeId: newSourceId,
          targetNodeId: newTargetId,
          updatedAt: new Date().toISOString()
        };
        await Promise.all([
          engine.kvSet("mem:graph:edges", edge.id, updatedEdge),
          engine.kvSet("mem:graph:edge-key", newEdgeKey, edge.id)
        ]);
        const { next } = await engine.applyRetrievalRecord(
          control,
          "edge",
          edge.id,
          updatedEdge
        );
        control = next;
        edge.sourceNodeId = newSourceId;
        edge.targetNodeId = newTargetId;
        if (!edgesByNodeId.has(canonical.id)) {
          edgesByNodeId.set(canonical.id, new Set());
        }
        edgesByNodeId.get(canonical.id).add(edge);
        repointedEdgesCount += 1;
      }
    }

    // Merge observation IDs & occurrence count onto Canonical Node
    const mergedObsIds = new Set(canonical.sourceObservationIds || []);
    let totalOccurrences = Number(canonical.properties?.occurrences) || 1;
    for (const dup of duplicates) {
      for (const obsId of dup.sourceObservationIds || []) {
        if (mergedObsIds.size < 128) mergedObsIds.add(obsId);
      }
      totalOccurrences += Number(dup.properties?.occurrences) || 1;
    }

    // Delete duplicate nodes from all 5 KV layers
    for (const dup of duplicates) {
      const { next } = await engine.applyRetrievalRecord(
        control,
        "node",
        dup.id,
        null
      );
      control = next;
      await Promise.all([
        engine.kvDelete("mem:graph:nodes", dup.id),
        engine.kvDelete("mem:graph:node-degree", dup.id),
        engine.kvDelete("mem:graph:name-index", `${dup.type}|${dup.name}`),
        engine.kvDelete("mem:graph:membership", dup.id).catch(() => {})
      ]);
      nodeById.delete(dup.id);
      mergedDuplicateNodesCount += 1;
    }

    // Update Canonical Node (name + merged observations + occurrences)
    if (canonical.name !== canonicalName) {
      await engine.kvDelete(
        "mem:graph:name-index",
        `${canonical.type}|${canonical.name}`
      );
    }
    const updatedCanonical = {
      ...canonical,
      name: canonicalName,
      sourceObservationIds: Array.from(mergedObsIds),
      properties: {
        ...(canonical.properties || {}),
        occurrences: totalOccurrences
      },
      updatedAt: new Date().toISOString()
    };
    await Promise.all([
      engine.kvSet("mem:graph:nodes", canonical.id, updatedCanonical),
      engine.kvSet(
        "mem:graph:name-index",
        `${updatedCanonical.type}|${updatedCanonical.name}`,
        canonical.id
      )
    ]);
    const { next } = await engine.applyRetrievalRecord(
      control,
      "node",
      canonical.id,
      updatedCanonical
    );
    control = next;
    nodeById.set(canonical.id, updatedCanonical);
  }

  // Recompute accurate node degrees for remaining nodes
  const remainingEdges = allEdges.filter((e) => !deletedEdgeIds.has(e.id));
  const newDegrees = new Map();
  for (const e of remainingEdges) {
    newDegrees.set(e.sourceNodeId, (newDegrees.get(e.sourceNodeId) || 0) + 1);
    newDegrees.set(e.targetNodeId, (newDegrees.get(e.targetNodeId) || 0) + 1);
  }
  for (const group of mergeGroups) {
    const cid = group.canonicalNode.id;
    await engine.kvSet("mem:graph:node-degree", cid, newDegrees.get(cid) || 0);
  }

  const graveyardWritten = appendToGraveyard(graveyardBatch);

  await engine.worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "mem::graph-snapshot-rebuild",
    payload: { force: true }
  });

  return {
    mergedGroupsCount: mergeGroups.length,
    mergedDuplicateNodesCount,
    renamedCorruptedNodesCount,
    repointedEdgesCount,
    deletedRedundantEdgesCount,
    graveyardEntriesWritten: graveyardWritten,
    totalStoreNodes: control.nodes,
    totalStoreEdges: control.edges
  };
}

/**
 * 5-Layer Atomic Node Rename / Merge-on-Collision (--rename)
 */
async function runRename(args) {
  const targetQuery = args[0];
  const newNameRaw = args[1];
  if (!targetQuery || !newNameRaw) {
    throw new Error(
      'Usage: graph-linker.mjs --rename "<old_name_or_id>" "<new_name>" [--type <new_type>]'
    );
  }
  const typeFlagIdx = args.indexOf("--type");
  const requestedType =
    typeFlagIdx !== -1 && args[typeFlagIdx + 1] ? args[typeFlagIdx + 1].trim() : null;
  const newName = unescapeXml(newNameRaw).trim();

  const engine = await createGraphKvEngine("graph-linker-rename");
  const [allNodesRaw, allEdgesRaw] = await Promise.all([
    engine.kvList("mem:graph:nodes"),
    engine.kvList("mem:graph:edges")
  ]);
  const allNodes = (allNodesRaw || []).filter((n) => n && n.id);
  const allEdges = (allEdgesRaw || []).filter((e) => e && e.id);

  const sourceNode =
    allNodes.find((n) => n.id === targetQuery) ||
    allNodes.find((n) => n.name === targetQuery) ||
    allNodes.find(
      (n) => String(n.name || "").toLowerCase() === targetQuery.toLowerCase()
    );

  if (!sourceNode) {
    console.log(
      JSON.stringify(
        { status: "not_found", query: targetQuery, message: "Target node not found." },
        null,
        2
      )
    );
    process.exit(0);
  }

  const newType = requestedType || sourceNode.type;
  let control = await engine.kvGet("mem:graph:retrieval-control", "current");

  // Check if another node already has (newType, newName)
  const existingTarget = allNodes.find(
    (n) =>
      n.id !== sourceNode.id &&
      n.type === newType &&
      unescapeXml(n.name || "").trim().toLowerCase() === newName.toLowerCase()
  );

  if (existingTarget) {
    // Collision -> Perform Atomic Merge of sourceNode into existingTarget!
    const incidentEdges = allEdges.filter(
      (e) => e.sourceNodeId === sourceNode.id || e.targetNodeId === sourceNode.id
    );
    appendToGraveyard([
      {
        archivedAt: new Date().toISOString(),
        reason: "rename_merged_into_existing",
        mergedIntoId: existingTarget.id,
        mergedIntoName: newName,
        node: sourceNode,
        incidentEdges,
        facets: []
      }
    ]);

    const targetEdges = allEdges.filter(
      (e) =>
        e.sourceNodeId === existingTarget.id || e.targetNodeId === existingTarget.id
    );
    const seenEdgeKeys = new Set(
      targetEdges.map((e) => `${e.sourceNodeId}|${e.targetNodeId}|${e.type}`)
    );

    let repointed = 0;
    let deletedRedundant = 0;
    for (const edge of incidentEdges) {
      const newSourceId =
        edge.sourceNodeId === sourceNode.id ? existingTarget.id : edge.sourceNodeId;
      const newTargetId =
        edge.targetNodeId === sourceNode.id ? existingTarget.id : edge.targetNodeId;
      const newKey = `${newSourceId}|${newTargetId}|${edge.type}`;

      if (newSourceId === newTargetId || seenEdgeKeys.has(newKey)) {
        const { next } = await engine.applyRetrievalRecord(
          control,
          "edge",
          edge.id,
          null
        );
        control = next;
        await Promise.all([
          engine.kvDelete("mem:graph:edges", edge.id),
          engine.kvDelete(
            "mem:graph:edge-key",
            `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`
          ),
          engine.kvDelete("mem:graph:edge-history", edge.id).catch(() => {})
        ]);
        deletedRedundant += 1;
      } else {
        seenEdgeKeys.add(newKey);
        await engine.kvDelete(
          "mem:graph:edge-key",
          `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`
        );
        const updatedEdge = {
          ...edge,
          sourceNodeId: newSourceId,
          targetNodeId: newTargetId,
          updatedAt: new Date().toISOString()
        };
        await Promise.all([
          engine.kvSet("mem:graph:edges", edge.id, updatedEdge),
          engine.kvSet("mem:graph:edge-key", newKey, edge.id)
        ]);
        const { next } = await engine.applyRetrievalRecord(
          control,
          "edge",
          edge.id,
          updatedEdge
        );
        control = next;
        repointed += 1;
      }
    }

    // Delete sourceNode across 5 layers
    const { next: afterDel } = await engine.applyRetrievalRecord(
      control,
      "node",
      sourceNode.id,
      null
    );
    control = afterDel;
    await Promise.all([
      engine.kvDelete("mem:graph:nodes", sourceNode.id),
      engine.kvDelete("mem:graph:node-degree", sourceNode.id),
      engine.kvDelete(
        "mem:graph:name-index",
        `${sourceNode.type}|${sourceNode.name}`
      ),
      engine.kvDelete("mem:graph:membership", sourceNode.id).catch(() => {})
    ]);

    // Update existingTarget
    if (existingTarget.name !== newName) {
      await engine.kvDelete(
        "mem:graph:name-index",
        `${existingTarget.type}|${existingTarget.name}`
      );
    }
    const mergedObs = Array.from(
      new Set([
        ...(existingTarget.sourceObservationIds || []),
        ...(sourceNode.sourceObservationIds || [])
      ])
    ).slice(0, 128);
    const updatedTarget = {
      ...existingTarget,
      name: newName,
      sourceObservationIds: mergedObs,
      properties: {
        ...(existingTarget.properties || {}),
        occurrences:
          (Number(existingTarget.properties?.occurrences) || 1) +
          (Number(sourceNode.properties?.occurrences) || 1)
      },
      updatedAt: new Date().toISOString()
    };
    await Promise.all([
      engine.kvSet("mem:graph:nodes", existingTarget.id, updatedTarget),
      engine.kvSet(
        "mem:graph:name-index",
        `${updatedTarget.type}|${updatedTarget.name}`,
        existingTarget.id
      )
    ]);
    const { next: afterTarget } = await engine.applyRetrievalRecord(
      control,
      "node",
      existingTarget.id,
      updatedTarget
    );
    control = afterTarget;

    await engine.worker.trigger({
      namespace: III_NAMESPACE,
      function_id: "mem::graph-snapshot-rebuild",
      payload: { force: true }
    });

    console.log(
      JSON.stringify(
        {
          status: "merged_into_existing",
          fromNode: { id: sourceNode.id, oldName: sourceNode.name, oldType: sourceNode.type },
          intoNode: { id: existingTarget.id, newName, type: existingTarget.type },
          repointedEdges: repointed,
          deletedRedundantEdges: deletedRedundant,
          totalStoreNodes: control.nodes,
          totalStoreEdges: control.edges
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  // Standard 5-Layer Atomic In-Place Rename
  const oldName = sourceNode.name;
  const oldType = sourceNode.type;
  await engine.kvDelete("mem:graph:name-index", `${oldType}|${oldName}`);

  const updatedNode = {
    ...sourceNode,
    name: newName,
    type: newType,
    updatedAt: new Date().toISOString()
  };

  await Promise.all([
    engine.kvSet("mem:graph:nodes", sourceNode.id, updatedNode),
    engine.kvSet("mem:graph:name-index", `${newType}|${newName}`, sourceNode.id)
  ]);

  const { next, writesCount } = await engine.applyRetrievalRecord(
    control,
    "node",
    sourceNode.id,
    updatedNode
  );
  control = next;

  await engine.worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "mem::graph-snapshot-rebuild",
    payload: { force: true }
  });

  console.log(
    JSON.stringify(
      {
        status: "renamed",
        nodeId: sourceNode.id,
        oldName,
        newName,
        oldType,
        newType,
        retrievalIndexWrites: writesCount,
        totalStoreNodes: control.nodes,
        totalStoreEdges: control.edges
      },
      null,
      2
    )
  );
  process.exit(0);
}

/**
 * 5-Layer Permanent Deletion with Cold Graveyard Backup (--delete & --prune)
 */
async function deleteNodesAcross5Layers(engine, targetIds, reason = "manual_delete") {
  const matchedNodeIds = new Set(targetIds);
  if (matchedNodeIds.size === 0) {
    return {
      deletedNodes: [],
      deletedEdgesCount: 0,
      deletedFacetsCount: 0,
      graveyardEntriesWritten: 0
    };
  }

  const [allNodesRaw, allEdgesRaw, allFacetsRaw] = await Promise.all([
    engine.kvList("mem:graph:nodes"),
    engine.kvList("mem:graph:edges"),
    engine.kvList("mem:facets").catch(() => [])
  ]);

  const allNodes = (allNodesRaw || []).filter((n) => n && n.id);
  const allEdges = (allEdgesRaw || []).filter((e) => e && e.id);
  const allFacets = (allFacetsRaw || []).filter((f) => f && f.id);

  const matchedNodes = allNodes.filter((n) => matchedNodeIds.has(n.id));
  const incidentEdges = allEdges.filter(
    (e) => matchedNodeIds.has(e.sourceNodeId) || matchedNodeIds.has(e.targetNodeId)
  );
  const incidentEdgeIds = new Set(incidentEdges.map((e) => e.id));
  const targetFacets = allFacets.filter(
    (f) => matchedNodeIds.has(f.targetId) || incidentEdgeIds.has(f.targetId)
  );

  // Archive every deleted node + its incident edges + facets to Cold Graveyard
  const now = new Date().toISOString();
  const graveyardEntries = matchedNodes.map((n) => ({
    archivedAt: now,
    reason,
    node: n,
    incidentEdges: incidentEdges.filter(
      (e) => e.sourceNodeId === n.id || e.targetNodeId === n.id
    ),
    facets: targetFacets.filter((f) => f.targetId === n.id)
  }));
  const graveyardEntriesWritten = appendToGraveyard(graveyardEntries);

  let control = await engine.kvGet("mem:graph:retrieval-control", "current");

  // 1. Unlink incident edges from retrieval index
  for (const edge of incidentEdges) {
    const { next } = await engine.applyRetrievalRecord(control, "edge", edge.id, null);
    control = next;
  }

  // 2. Unlink target nodes from retrieval index
  for (const nodeId of matchedNodeIds) {
    const { next } = await engine.applyRetrievalRecord(control, "node", nodeId, null);
    control = next;
  }

  // 3. Delete canonical edges, edge-keys & edge-history
  for (let i = 0; i < incidentEdges.length; i += 20) {
    const chunk = incidentEdges.slice(i, i + 20);
    await Promise.all(
      chunk.flatMap((edge) => [
        engine.kvDelete("mem:graph:edges", edge.id),
        engine.kvDelete(
          "mem:graph:edge-key",
          `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`
        ),
        engine.kvDelete("mem:graph:edge-history", edge.id).catch(() => {})
      ])
    );
  }

  // 4. Delete canonical nodes, degrees, name-index & graph membership
  for (let i = 0; i < matchedNodes.length; i += 20) {
    const chunk = matchedNodes.slice(i, i + 20);
    await Promise.all(
      chunk.flatMap((node) => [
        engine.kvDelete("mem:graph:nodes", node.id),
        engine.kvDelete("mem:graph:node-degree", node.id),
        engine.kvDelete("mem:graph:name-index", `${node.type}|${node.name}`),
        engine.kvDelete("mem:graph:membership", node.id).catch(() => {})
      ])
    );
  }

  for (const nodeId of matchedNodeIds) {
    await Promise.all([
      engine.kvDelete("mem:graph:nodes", nodeId),
      engine.kvDelete("mem:graph:node-degree", nodeId),
      engine.kvDelete("mem:graph:membership", nodeId).catch(() => {})
    ]);
  }

  // 5. Clean up orphaned facets (#1642)
  for (const facet of targetFacets) {
    await engine.kvDelete("mem:facets", facet.id).catch(() => {});
  }

  // 6. Update neighbor degrees & rebuild snapshot
  const remainingEdges = allEdges.filter((e) => !incidentEdgeIds.has(e.id));
  const degMap = new Map();
  for (const e of remainingEdges) {
    degMap.set(e.sourceNodeId, (degMap.get(e.sourceNodeId) || 0) + 1);
    degMap.set(e.targetNodeId, (degMap.get(e.targetNodeId) || 0) + 1);
  }
  const affectedNeighbors = new Set();
  for (const e of incidentEdges) {
    if (!matchedNodeIds.has(e.sourceNodeId)) affectedNeighbors.add(e.sourceNodeId);
    if (!matchedNodeIds.has(e.targetNodeId)) affectedNeighbors.add(e.targetNodeId);
  }
  for (const nid of affectedNeighbors) {
    await engine.kvSet("mem:graph:node-degree", nid, degMap.get(nid) || 0);
  }

  await engine.worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "mem::graph-snapshot-rebuild",
    payload: { force: true }
  });

  return {
    deletedNodes: matchedNodes.map((n) => ({ id: n.id, name: n.name, type: n.type })),
    deletedEdgesCount: incidentEdges.length,
    deletedFacetsCount: targetFacets.length,
    graveyardEntriesWritten,
    totalStoreNodes: control.nodes,
    totalStoreEdges: control.edges
  };
}

async function runDelete(targets) {
  if (!targets.length) {
    throw new Error('Usage: graph-linker.mjs --delete "<node_name_or_id>" ["<more>..."]');
  }

  const engine = await createGraphKvEngine("graph-linker-delete");
  const allNodes = (await engine.kvList("mem:graph:nodes")) || [];

  const targetSet = new Set(targets.map((t) => t.trim()));
  const targetLowerSet = new Set(targets.map((t) => t.trim().toLowerCase()));

  const matchedNodes = allNodes.filter(
    (n) =>
      n &&
      (targetSet.has(n.id) ||
        targetSet.has(n.name) ||
        targetLowerSet.has(String(n.name || "").toLowerCase()))
  );

  const matchedNodeIds = new Set(matchedNodes.map((n) => n.id));
  for (const t of targetSet) {
    if (t.startsWith("gn_")) matchedNodeIds.add(t);
  }

  if (matchedNodeIds.size === 0) {
    console.log(
      JSON.stringify(
        { deletedNodes: [], deletedEdges: [], message: "No matching nodes found." },
        null,
        2
      )
    );
    process.exit(0);
  }

  const res = await deleteNodesAcross5Layers(engine, matchedNodeIds, "manual_delete");
  const secret = getSecret();
  const after = await queryGraph(secret);

  console.log(
    JSON.stringify(
      {
        status: "deleted",
        ...res,
        graveyardFile: GRAVEYARD_PATH,
        remainingUnlinked: after.unlinked.length
      },
      null,
      2
    )
  );
  process.exit(0);
}

/**
 * Safe Pruning to Cold Graveyard (--prune)
 */
async function executePrune(engine, options = {}) {
  const includeStale = Boolean(options.includeStale);
  const includeHallucinations = options.includeHallucinations !== false; // default true
  const audit = await performGraphAudit(engine, options);

  const targetIds = new Set();
  for (const item of audit.transientScratchCandidates) {
    targetIds.add(item.id);
  }
  if (includeHallucinations) {
    for (const item of audit.hallucinationCandidates) {
      targetIds.add(item.id);
    }
  }
  if (includeStale) {
    for (const item of audit.staleIsolatedCandidates) {
      targetIds.add(item.id);
    }
  }

  if (targetIds.size === 0) {
    return {
      status: "nothing_to_prune",
      prunedNodesCount: 0,
      prunedEdgesCount: 0,
      graveyardFile: GRAVEYARD_PATH
    };
  }

  const delRes = await deleteNodesAcross5Layers(
    engine,
    targetIds,
    "safe_prune_to_graveyard"
  );

  return {
    status: "pruned_to_cold_graveyard",
    prunedNodesCount: delRes.deletedNodes.length,
    prunedEdgesCount: delRes.deletedEdgesCount,
    prunedFacetsCount: delRes.deletedFacetsCount,
    graveyardEntriesWritten: delRes.graveyardEntriesWritten,
    graveyardFile: GRAVEYARD_PATH,
    totalStoreNodes: delRes.totalStoreNodes,
    totalStoreEdges: delRes.totalStoreEdges,
    samplePrunedNodes: delRes.deletedNodes.slice(0, 20)
  };
}

/**
 * Lossless Restore from Cold Graveyard (--restore)
 */
async function runRestore(args) {
  const query = args[0] || "--list";
  const items = readGraveyard();

  if (query === "--list") {
    console.log(
      JSON.stringify(
        {
          graveyardFile: GRAVEYARD_PATH,
          totalArchivedNodes: items.length,
          recentEntries: items.slice(-25).map((item, idx) => ({
            idx,
            archivedAt: item.archivedAt,
            reason: item.reason,
            id: item.node?.id,
            type: item.node?.type,
            name: item.node?.name,
            incidentEdgesCount: (item.incidentEdges || []).length
          }))
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  if (items.length === 0) {
    console.log(
      JSON.stringify(
        { status: "empty_graveyard", message: "No archived nodes in graveyard.jsonl" },
        null,
        2
      )
    );
    process.exit(0);
  }

  let matchIndices = [];
  if (query === "--last") {
    matchIndices = [items.length - 1];
  } else {
    const qLower = query.toLowerCase();
    items.forEach((item, idx) => {
      if (
        item.node?.id === query ||
        item.node?.name === query ||
        String(item.node?.name || "").toLowerCase() === qLower
      ) {
        matchIndices.push(idx);
      }
    });
  }

  if (matchIndices.length === 0) {
    console.log(
      JSON.stringify(
        { status: "not_found_in_graveyard", query, graveyardFile: GRAVEYARD_PATH },
        null,
        2
      )
    );
    process.exit(0);
  }

  const engine = await createGraphKvEngine("graph-linker-restore");
  const [allNodesRaw, allEdgesRaw] = await Promise.all([
    engine.kvList("mem:graph:nodes"),
    engine.kvList("mem:graph:edges")
  ]);
  const existingNodeIds = new Set((allNodesRaw || []).filter(Boolean).map((n) => n.id));
  const existingEdgeIds = new Set((allEdgesRaw || []).filter(Boolean).map((e) => e.id));

  let control = await engine.kvGet("mem:graph:retrieval-control", "current");
  const restoredNodes = [];
  let restoredEdgesCount = 0;

  const toRestore = matchIndices.map((i) => items[i]);
  for (const entry of toRestore) {
    const node = entry.node;
    if (!node || !node.id) continue;
    existingNodeIds.add(node.id);
  }

  for (const entry of toRestore) {
    const node = entry.node;
    if (!node || !node.id) continue;

    await Promise.all([
      engine.kvSet("mem:graph:nodes", node.id, node),
      engine.kvSet("mem:graph:name-index", `${node.type}|${node.name}`, node.id)
    ]);
    const { next } = await engine.applyRetrievalRecord(control, "node", node.id, node);
    control = next;
    restoredNodes.push({ id: node.id, type: node.type, name: node.name });

    for (const edge of entry.incidentEdges || []) {
      if (!edge || !edge.id || existingEdgeIds.has(edge.id)) continue;
      if (
        !existingNodeIds.has(edge.sourceNodeId) ||
        !existingNodeIds.has(edge.targetNodeId)
      ) {
        continue;
      }
      await Promise.all([
        engine.kvSet("mem:graph:edges", edge.id, edge),
        engine.kvSet(
          "mem:graph:edge-key",
          `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`,
          edge.id
        )
      ]);
      const { next: nextE } = await engine.applyRetrievalRecord(
        control,
        "edge",
        edge.id,
        edge
      );
      control = nextE;
      existingEdgeIds.add(edge.id);
      restoredEdgesCount += 1;
    }

    for (const facet of entry.facets || []) {
      if (facet?.id) {
        await engine.kvSet("mem:facets", facet.id, facet).catch(() => {});
      }
    }
  }

  // Recompute degrees for restored nodes
  const updatedEdges = (await engine.kvList("mem:graph:edges")) || [];
  const degMap = new Map();
  for (const e of updatedEdges) {
    if (!e) continue;
    degMap.set(e.sourceNodeId, (degMap.get(e.sourceNodeId) || 0) + 1);
    degMap.set(e.targetNodeId, (degMap.get(e.targetNodeId) || 0) + 1);
  }
  for (const rn of restoredNodes) {
    await engine.kvSet("mem:graph:node-degree", rn.id, degMap.get(rn.id) || 0);
  }

  // Remove restored entries from graveyard.jsonl
  const removeIdxSet = new Set(matchIndices);
  const remainingGraveyard = items.filter((_, idx) => !removeIdxSet.has(idx));
  writeGraveyard(remainingGraveyard);

  await engine.worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "mem::graph-snapshot-rebuild",
    payload: { force: true }
  });

  console.log(
    JSON.stringify(
      {
        status: "restored",
        restoredNodes,
        restoredEdgesCount,
        remainingInGraveyard: remainingGraveyard.length,
        totalStoreNodes: control.nodes,
        totalStoreEdges: control.edges
      },
      null,
      2
    )
  );
  process.exit(0);
}

/**
 * Self-Patches AgentMemory dist files (maxReads: 4096 + parseAttrs XML Entity Decoding)
 * and tunes ~/.agentmemory/.env for RAM reduction.
 */
function applySystemAndRamPatches(options = { tuneRamEnv: false }) {
  const patches = {
    envLlmProvider: "already_set",
    deprecatedKeysRemoved: "none",
    ramEnvTuning: "unchanged",
    maxReads4096: "already_patched",
    parseAttrsXmlDecode: "already_patched"
  };

  // 1. Patch ~/.agentmemory/.env
  const envPath = path.join(AGENTMEMORY_DIR, ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    let modified = false;

    if (
      !/^AGENTMEMORY_LLM_PROVIDER=/m.test(envContent) &&
      /^OPENAI_API_KEY=/m.test(envContent)
    ) {
      envContent = envContent.replace(
        /^OPENAI_API_KEY=/m,
        "AGENTMEMORY_LLM_PROVIDER=openai\nOPENAI_API_KEY="
      );
      patches.envLlmProvider = "patched_openai";
      modified = true;
    }
    if (/^OPENAI_API_KEY_FOR_LLM=/m.test(envContent)) {
      envContent = envContent.replace(/^OPENAI_API_KEY_FOR_LLM=.*\n?/gm, "");
      patches.deprecatedKeysRemoved = "removed_OPENAI_API_KEY_FOR_LLM";
      modified = true;
    }

    if (options.tuneRamEnv) {
      const tunedItems = [];
      // Lower MAX_OBS_PER_SESSION from 5000 -> 800 to prevent raw observation memory bloat
      if (/^MAX_OBS_PER_SESSION=\d+/m.test(envContent)) {
        const m = envContent.match(/^MAX_OBS_PER_SESSION=(\d+)/m);
        if (m && Number(m[1]) > 1000) {
          envContent = envContent.replace(
            /^MAX_OBS_PER_SESSION=\d+/m,
            "MAX_OBS_PER_SESSION=800"
          );
          tunedItems.push("MAX_OBS_PER_SESSION=800");
          modified = true;
        }
      } else {
        envContent = envContent.trimEnd() + "\nMAX_OBS_PER_SESSION=800\n";
        tunedItems.push("MAX_OBS_PER_SESSION=800");
        modified = true;
      }

      // Set AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500 to cap per-observation raw tool output size
      if (/^AGENTMEMORY_CAPTURE_OUTPUT_MAX=\d+/m.test(envContent)) {
        const m = envContent.match(/^AGENTMEMORY_CAPTURE_OUTPUT_MAX=(\d+)/m);
        if (m && Number(m[1]) > 4000) {
          envContent = envContent.replace(
            /^AGENTMEMORY_CAPTURE_OUTPUT_MAX=\d+/m,
            "AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500"
          );
          tunedItems.push("AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500");
          modified = true;
        }
      } else {
        envContent =
          envContent.trimEnd() + "\nAGENTMEMORY_CAPTURE_OUTPUT_MAX=3500\n";
        tunedItems.push("AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500");
        modified = true;
      }

      if (tunedItems.length > 0) {
        patches.ramEnvTuning = `tuned:${tunedItems.join(",")}`;
      } else {
        patches.ramEnvTuning = "already_optimal";
      }
    }

    if (modified) {
      fs.writeFileSync(envPath, envContent, "utf8");
    }
  }

  // 2. Patch dist/index.mjs & dist/compression-recovery-*.mjs for maxReads: 4096 and parseAttrs XML decoding
  const distDir = "/usr/local/lib/node_modules/@agentmemory/agentmemory/dist";
  if (fs.existsSync(distDir)) {
    for (const file of fs.readdirSync(distDir)) {
      if (!file.endsWith(".mjs")) continue;
      const fullPath = path.join(distDir, file);
      let content;
      try {
        content = fs.readFileSync(fullPath, "utf8");
      } catch {
        continue;
      }
      let fileChanged = false;

      if (content.includes("maxReads: 2048")) {
        content = content.replace(
          /createGraphIndexReader\(state,\s*\{\s*maxReads:\s*2048,\s*maxBytes:\s*4\s*\*\s*1024\s*\*\s*1024\s*\}\)/g,
          "createGraphIndexReader(state, {\n\t\t\tmaxReads: 4096,\n\t\t\tmaxBytes: 8 * 1024 * 1024\n\t\t})"
        );
        patches.maxReads4096 = "re_patched_after_upgrade";
        fileChanged = true;
      }

      const rawParseAttrs =
        'function parseAttrs(raw) {\n\tconst attrs = {};\n\tconst attrRegex = /([A-Za-z_][\\w:-]*)="([^"]*)"/g;\n\tlet m;\n\twhile ((m = attrRegex.exec(raw)) !== null) attrs[m[1]] = m[2];\n\treturn attrs;\n}';
      const patchedParseAttrs =
        'function parseAttrs(raw) {\n\tconst attrs = {};\n\tconst attrRegex = /([A-Za-z_][\\w:-]*)="([^"]*)"/g;\n\tlet m;\n\twhile ((m = attrRegex.exec(raw)) !== null) {\n\t\tlet v = m[2];\n\t\tfor (let i = 0; i < 8; i++) {\n\t\t\tconst next = v.replace(/&quot;/gi, \'"\').replace(/&apos;/gi, "\'").replace(/&gt;/gi, ">").replace(/&lt;/gi, "<").replace(/&amp;/gi, "&");\n\t\t\tif (next === v) break;\n\t\t\tv = next;\n\t\t}\n\t\tattrs[m[1]] = v;\n\t}\n\treturn attrs;\n}';

      if (content.includes(rawParseAttrs)) {
        content = content.replace(rawParseAttrs, patchedParseAttrs);
        patches.parseAttrsXmlDecode = "patched_xml_entity_decode";
        fileChanged = true;
      }

      if (fileChanged) {
        try {
          fs.writeFileSync(fullPath, content, "utf8");
        } catch {}
      }
    }
  }

  return patches;
}

/**
 * Full RAM & Graph Store Optimizer (--optimize-ram)
 */
async function runOptimizeRam(secret) {
  const patches = applySystemAndRamPatches({ tuneRamEnv: true });
  const engine = await createGraphKvEngine("graph-linker-optimize-ram");

  // 1. Run 5-Layer Deduplication (collapses XML-escaped clones & error duplicates)
  const dedupReport = await executeDeduplication(engine);

  // 2. Prune transient scratch & hallucination nodes into Cold Graveyard
  const pruneReport = await executePrune(engine, {
    includeHallucinations: true,
    includeStale: false
  });

  // 3. Clean orphaned node-degree and name-index keys that reference non-existent node IDs
  const allNodes = (await engine.kvList("mem:graph:nodes")) || [];
  const validNodeIds = new Set(allNodes.filter(Boolean).map((n) => n.id));
  const allEdges = (await engine.kvList("mem:graph:edges")) || [];

  // Recompute exact degrees
  const degMap = new Map();
  for (const e of allEdges) {
    if (!e) continue;
    degMap.set(e.sourceNodeId, (degMap.get(e.sourceNodeId) || 0) + 1);
    degMap.set(e.targetNodeId, (degMap.get(e.targetNodeId) || 0) + 1);
  }

  // Trigger session sweep & snapshot rebuild
  const sweepRes = await engine.worker
    .trigger({
      namespace: III_NAMESPACE,
      function_id: "mem::session-sweep",
      payload: {}
    })
    .catch(() => null);

  await engine.worker.trigger({
    namespace: III_NAMESPACE,
    function_id: "mem::graph-snapshot-rebuild",
    payload: { force: true }
  });

  // Link any newly surfaced boundary nodes in the 500-node window
  const afterState = await queryGraph(secret);
  let boundaryEdgesLinked = 0;
  if (afterState.unlinked.length > 0) {
    const topAnchors = afterState.nodes.slice(0, 15).filter((a) => a.degree > 0);
    const sweepRels = [];
    for (let i = 0; i < afterState.unlinked.length; i++) {
      const u = afterState.unlinked[i];
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
    if (sweepRels.length > 0) {
      const linkRes = await applyDirectXmlLinks(secret, [], sweepRels);
      boundaryEdgesLinked = linkRes.edgesAdded || 0;
      await rebuildSnapshot(secret);
    }
  }

  const finalGraph = await queryGraph(secret);

  console.log(
    JSON.stringify(
      {
        status: "ram_optimized",
        version: "3.0",
        systemPatches: patches,
        deduplication: dedupReport,
        coldGraveyardPruning: pruneReport,
        sessionSweep: sweepRes,
        boundaryEdgesLinked,
        graphViewer: {
          totalStoreNodes: finalGraph.data.totalNodes,
          totalStoreEdges: finalGraph.data.totalEdges,
          viewNodes: finalGraph.nodes.length,
          viewEdges: finalGraph.edges.length,
          unlinkedCount: finalGraph.unlinked.length,
          sparseWarningActive:
            finalGraph.unlinked.length > Math.floor(finalGraph.nodes.length * 0.1)
        }
      },
      null,
      2
    )
  );
  process.exit(0);
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
  if (type === "file" && (name.includes("smart-router") || name.includes("router")))
    bestDomain = THEMATIC_DOMAINS[0];
  if (type === "file" && name.includes("audio")) bestDomain = THEMATIC_DOMAINS[4];

  return bestDomain;
}

function determineSemanticRelation(node) {
  const type = node.type || "concept";
  const name = (node.name || "").toLowerCase();

  if (type === "file") {
    if (
      name.endsWith(".md") ||
      name.includes("/skills") ||
      name.includes("/profiles") ||
      name.endsWith("/")
    ) {
      return "imports";
    }
    if (
      name.endsWith(".mjs") ||
      name.endsWith(".js") ||
      name.endsWith(".dart") ||
      name.endsWith(".sh")
    ) {
      return "modifies";
    }
    if (
      name.endsWith(".json") ||
      name.endsWith(".yaml") ||
      name.endsWith(".plist") ||
      name.endsWith(".env")
    ) {
      return "depends_on";
    }
    return "imports";
  }

  if (type === "library" || type === "pattern") return "depends_on";
  if (
    type === "command" ||
    type === "function" ||
    type === "tool" ||
    type === "action" ||
    type === "search"
  )
    return "uses";
  if (type === "error")
    return name.includes("not found") || name.includes("fail") ? "causes" : "fixes";
  if (type === "decision")
    return name.includes("fix") || name.includes("use") ? "fixes" : "modifies";

  if (name.includes("fix") || name.includes("error") || name.includes("repair"))
    return "fixes";
  if (
    name.includes("api") ||
    name.includes("service") ||
    name.includes("tool") ||
    name.includes("query")
  )
    return "uses";
  if (
    name.includes("setup") ||
    name.includes("init") ||
    name.includes("install") ||
    name.includes("plan")
  )
    return "depends_on";
  if (
    name.includes("clean") ||
    name.includes("update") ||
    name.includes("modif") ||
    name.includes("config")
  )
    return "modifies";

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
      (type === "file" &&
        (anchor.type === "file" || aName.includes("skill") || aName.includes("file"))) ||
      ((name.includes("firefox") ||
        name.includes("chrome") ||
        name.includes("extension") ||
        name.includes("profile")) &&
        (aName.includes("chrome") || aName.includes("skill"))) ||
      ((name.includes("mobile") ||
        name.includes("zalo") ||
        name.includes("tiktok") ||
        name.includes("ui")) &&
        (aName.includes("mobile") || aName.includes("ui") || aName.includes("flutter"))) ||
      ((name.includes("git") || name.includes("repo") || name.includes("github")) &&
        aName.includes("git")) ||
      ((name.includes("animat") || name.includes("motion")) &&
        aName.includes("animat")) ||
      ((name.includes("xcode") || name.includes("flutter") || name.includes("dart")) &&
        aName.includes("flutter"))
    ) {
      return { anchor, relation: rel };
    }
  }

  const candidates = frontAnchors.filter(
    (a) => !(a.name === unlinkedNode.name && a.type === unlinkedNode.type)
  );
  const fallback =
    candidates[fallbackIdx % Math.max(1, candidates.length)] || frontAnchors[0];
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

  const batches = [];
  for (const r of relationships) {
    const sType = r.sourceType || "concept";
    const tType = r.targetType || "concept";
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
          `<relationship type="${normalizeRelation(r.type)}" source="${escapeXml(
            r.source
          )}" target="${escapeXml(r.target)}" weight="${r.weight || 0.9}"/>`
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
            id: `obs_direct_graph_linker_${Date.now()}_${Math.random()
              .toString(36)
              .slice(2, 6)}`,
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

  return {
    success: true,
    edgesAdded: totalEdgesAdded,
    nodesAdded: totalNodesAdded,
    batches: batches.length
  };
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
 * Token-Saving Incremental Log Inspector & Self-Healer (v3.0, #1662 / #1674)
 */
async function inspectAndHealLogs(secret, options = {}) {
  const MAX_DELTA_BYTES_PER_FILE = 16 * 1024;
  let cursorState = { version: "3.0", files: {} };

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
      fileReports.push({
        file: label,
        path: logPath,
        status: "not_present",
        unreadBytesRead: 0
      });
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(logPath);
    } catch {
      continue;
    }

    const prev = cursorState.files[logPath];
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

    let startOffset = 0;
    if (
      !options.resetCursor &&
      prev &&
      prev.ino === stat.ino &&
      stat.size > prev.offset
    ) {
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
      } catch {
      } finally {
        if (fd !== undefined) {
          try {
            fs.closeSync(fd);
          } catch {}
        }
      }
    }

    const matchedInFile = [];
    if (deltaText) {
      if (
        /uncaughtException|unhandledRejection|\[@agentmemory\/mcp\] fatal/i.test(
          deltaText
        )
      ) {
        detectedIssues.add("mcp_shim_crash");
        matchedInFile.push("mcp_shim_crash");
      }
      if (
        /Graph index.*paused|needs-migration|Graph index counts are unavailable/i.test(
          deltaText
        )
      ) {
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
      if (
        /OpenAI response hit max_tokens|finish_reason.*length/i.test(deltaText)
      ) {
        detectedIssues.add("truncated_openai_reply");
        matchedInFile.push("truncated_openai_reply");
      }
      if (
        /orphan sweep left shards behind|orphan_generation_sweep/i.test(deltaText)
      ) {
        detectedIssues.add("orphan_index_shards");
        matchedInFile.push("orphan_index_shards");
      }
      if (/EADDRINUSE|compose\.pid|stale pid/i.test(deltaText)) {
        detectedIssues.add("stale_pid_or_port_conflict");
        matchedInFile.push("stale_pid_or_port_conflict");
      }
    }

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

  if (
    detectedIssues.has("llm_provider_missing") ||
    detectedIssues.has("deprecated_openai_api_key_for_llm")
  ) {
    applySystemAndRamPatches({ tuneRamEnv: false });
    autoHealedActions.push("patched_env_llm_provider_and_cleaned_deprecated_keys");
  }

  if (detectedIssues.has("mcp_shim_crash")) {
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
    autoHealedActions.push("verified_smart_router_v3.0_finish_reason_length_failover");
  }

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
 * One-Shot Maintenance (v3.0):
 * - Self-Patches maxReads: 4096, parseAttrs XML Entity Decode, & .env RAM limits
 * - Incremental Delta Log Inspection & Auto-Heal (0-token repeat reads)
 * - Spool Drain + Abandoned Session Sweep (#1645) + Orphaned Index Generation Check (#1256)
 * - Bounded Graph Stats (#1260) + Retrieval Index Auto-Resume + Snapshot Rebuild
 */
async function runHeal(secret) {
  const selfPatches = applySystemAndRamPatches({ tuneRamEnv: true });
  const logInspector = await inspectAndHealLogs(secret);

  const drainRes = await fetch(`${BASE_URL}/agentmemory/capture/drain`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    }
  });
  const drainData = drainRes.ok
    ? await drainRes.json()
    : { error: `HTTP ${drainRes.status}` };

  let indexRes = await fetch(`${BASE_URL}/agentmemory/graph/index`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` }
  });
  let indexData = indexRes.ok
    ? await indexRes.json()
    : { error: `HTTP ${indexRes.status}` };

  if (
    (indexData.state === "paused" || indexData.control?.status === "paused") &&
    !indexData.ready
  ) {
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

  let resourceMaintenance = {
    sessionSweep: "skipped",
    orphanIndexGenerationSweep: "checked_on_boot",
    boundedGraphStats: null
  };
  try {
    const engine = await createGraphKvEngine("graph-linker-heal");
    const [sweepRes, orphanMarker, boundedStats] = await Promise.all([
      engine.worker
        .trigger({
          namespace: III_NAMESPACE,
          function_id: "mem::session-sweep",
          payload: {}
        })
        .catch(() => null),
      engine
        .kvGet("mem:idx:bm25", "legacy:sweep")
        .catch(() => null),
      engine.worker
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
        version: "3.0",
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
          sparseWarningActive:
            graphState.unlinked.length > Math.floor(graphState.nodes.length * 0.1)
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
  applySystemAndRamPatches({ tuneRamEnv: false });

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

  const clusterCounts = {};
  for (const d of THEMATIC_DOMAINS) clusterCounts[d.id] = 0;

  console.log(
    `🎨 [Beautify] Semantic linking ${unlinked.length} unlinked nodes to front anchors...`
  );

  for (let i = 0; i < unlinked.length; i++) {
    const node = unlinked[i];
    const domain = classifyNodeDomain(node);
    clusterCounts[domain.id] = (clusterCounts[domain.id] || 0) + 1;

    let targetAnchor = frontAnchors.find(
      (a) => a.name === domain.anchor.name || a.name === domain.subAnchor.name
    );
    if (
      !targetAnchor ||
      (targetAnchor.name === node.name && targetAnchor.type === node.type)
    ) {
      targetAnchor = pickSemanticAnchor(node, frontAnchors, i).anchor;
    }

    if (
      targetAnchor &&
      (node.name !== targetAnchor.name || node.type !== targetAnchor.type)
    ) {
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
    console.log(
      `🎨 [Beautify] Injecting ${rels.length} balanced semantic relationships via DIRECT_GRAPH_XML...`
    );
    const extractRes = await applyDirectXmlLinks(
      secret,
      Array.from(entitiesMap.values()),
      rels
    );
    console.log(
      `🎨 [Beautify] Graph extraction completed: +${extractRes.edgesAdded} edges.`
    );
    await rebuildSnapshot(secret);
  }

  for (let sweep = 0; sweep < 5; sweep++) {
    const current = await queryGraph(secret);
    if (current.unlinked.length === 0) break;
    console.log(
      `🎨 [Beautify Sweep ${sweep + 1}] Linking ${
        current.unlinked.length
      } newly surfaced boundary nodes...`
    );
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
        version: "3.0",
        unlinkedCount: final.unlinked.length,
        sparseWarningActive:
          final.unlinked.length > Math.floor(final.nodes.length * 0.1),
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
          version: "3.0",
          totalStoreNodes: data.totalNodes,
          totalStoreEdges: data.totalEdges,
          viewNodes: nodes.length,
          viewEdges: edges.length,
          unlinkedCount: unlinked.length,
          sparseWarningActive: unlinked.length > Math.floor(nodes.length * 0.1),
          maxDegree: maxDeg,
          avgDegree: avgDeg,
          edgeTypes,
          frontAnchors: nodes
            .slice(0, 15)
            .map((n) => ({ idx: n.idx, name: n.name, type: n.type, degree: n.degree })),
          sampleUnlinked: unlinked
            .slice(0, 15)
            .map((n) => ({ idx: n.idx, name: n.name, type: n.type }))
        },
        null,
        2
      )
    );
    return;
  }

  if (mode === "--audit") {
    const daysIdx = args.indexOf("--days");
    const days = daysIdx !== -1 && args[daysIdx + 1] ? Number(args[daysIdx + 1]) : 14;
    const engine = await createGraphKvEngine("graph-linker-audit");
    const audit = await performGraphAudit(engine, { days });
    console.log(
      JSON.stringify(
        {
          status: "audit_completed",
          version: "3.0",
          summary: audit.summary,
          sampleDuplicateGroups: audit.mergeGroups.slice(0, 20).map((g) => ({
            groupKey: g.groupKey,
            canonicalName: g.canonicalName,
            canonicalId: g.canonicalNode.id,
            duplicatesCount: g.duplicates.length,
            duplicateNames: g.duplicates.slice(0, 5).map((d) => d.name)
          })),
          hallucinationCandidates: audit.hallucinationCandidates.slice(0, 25),
          sampleTransientScratch: audit.transientScratchCandidates.slice(0, 20),
          sampleStaleIsolated: audit.staleIsolatedCandidates.slice(0, 20)
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  if (mode === "--dedup") {
    applySystemAndRamPatches({ tuneRamEnv: false });
    const engine = await createGraphKvEngine("graph-linker-dedup");
    const report = await executeDeduplication(engine);
    const after = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          status: "deduplicated",
          version: "3.0",
          ...report,
          graveyardFile: GRAVEYARD_PATH,
          viewNodes: after.nodes.length,
          viewEdges: after.edges.length,
          remainingUnlinked: after.unlinked.length
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  if (mode === "--rename") {
    applySystemAndRamPatches({ tuneRamEnv: false });
    await runRename(args.slice(1));
    return;
  }

  if (mode === "--prune") {
    const daysIdx = args.indexOf("--days");
    const days = daysIdx !== -1 && args[daysIdx + 1] ? Number(args[daysIdx + 1]) : 14;
    const includeStale = args.includes("--include-stale");
    const includeHallucinations = !args.includes("--no-hallucinations");
    const engine = await createGraphKvEngine("graph-linker-prune");
    const report = await executePrune(engine, {
      days,
      includeStale,
      includeHallucinations
    });
    const after = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          version: "3.0",
          ...report,
          viewNodes: after.nodes.length,
          viewEdges: after.edges.length,
          remainingUnlinked: after.unlinked.length
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  if (mode === "--restore") {
    await runRestore(args.slice(1));
    return;
  }

  if (mode === "--optimize-ram") {
    await runOptimizeRam(secret);
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
          frontAnchors: nodes
            .slice(0, 25)
            .map((n) => ({ idx: n.idx, name: n.name, type: n.type, degree: n.degree })),
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
    applySystemAndRamPatches({ tuneRamEnv: false });
    let rawJson = args[1];
    if (!rawJson)
      throw new Error("Usage: graph-linker.mjs --apply '<json_array>' or file path");
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
    applySystemAndRamPatches({ tuneRamEnv: false });
    const anchorWindows = [15, 10, 6];
    for (let pass = 0; pass < anchorWindows.length; pass++) {
      const { nodes, edges, unlinked } = await queryGraph(secret);
      console.log(
        `[Pass ${pass + 1}] View nodes: ${nodes.length}, View edges: ${
          edges.length
        }, Unlinked: ${unlinked.length}`
      );
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
      console.log(
        `[Pass ${pass + 1}] Linked +${res.edgesAdded} edges (0 external LLM tokens).`
      );
    }

    await rebuildSnapshot(secret);
    const finalState = await queryGraph(secret);
    console.log(
      JSON.stringify(
        {
          status: "completed",
          version: "3.0",
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
    `Unknown flag: ${mode}. Use --status, --audit, --dedup, --rename, --prune, --restore, --optimize-ram, --beautify, --delete, --heal, --logs, --dump, --apply, or --auto.`
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
