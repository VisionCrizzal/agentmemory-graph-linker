import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * AgentMemory 11-Tier Task-Aware Fault-Tolerant Smart AI Router (v4.0)
 * - Task-aware model tiering (fast high-quota for <observation>, accuracy-first for <summary> & <entities>)
 * - Surrogate-safe UTF-16 prompt & fallback slicing (#1598)
 * - Truncated reply (finish_reason === "length" / unclosed XML) detection & automatic tier failover (#1495)
 * - Zero-Token Hallucination, Unicode dash & Scratch Noise Gate on <entities>, <observation>, and <summary> XML
 * - Nested XML entity unescaping so &amp;quot; / &amp;lt; phantoms never enter the graph
 * - Instant Zero-Token DIRECT_GRAPH_XML passthrough (<1ms) and Maintenance Lock freeze
 */

const AGENTMEMORY_DIR = process.env.AGENTMEMORY_DATA_DIR || path.join(os.homedir(), ".agentmemory");
const MAINTENANCE_LOCK_PATH = path.join(AGENTMEMORY_DIR, "maintenance.lock");

const HALLUCINATION_ENTITY_REGEX =
  /\b(invasion\s+german|german\s+invasion|third\s+reich|adolf\s+hitler|nazi\s+party|world\s+war\s+ii|holocaust|soviet\s+invasion|roman\s+empire|medieval\s+europe)\b/i;

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;

const CJK_CANONICAL_MAP = new Map([
  ["多token预测", "Multi-Token Prediction (MTP)"],
  ["多Token预测", "Multi-Token Prediction (MTP)"],
  ["逆向工程", "Reverse Engineering"],
  ["グラフ解析", "Graph Analysis"],
  ["グラフ", "Graph"],
  ["深層学習", "Deep Learning"],
  ["機械学習", "Machine Learning"],
  ["自然言語処理", "Natural Language Processing"]
]);

function normalizeUnicodeDashes(str) {
  return String(str || "")
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212\u00ad]/g, "-")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoisyScratchEntityName(name) {
  const nm = normalizeUnicodeDashes(name);
  if (!nm) return true;
  if (
    nm.includes("/.system_generated/") ||
    nm.includes("/.user_uploaded/media_") ||
    /^media_\d+_[0-9a-f]+\.[a-z0-9]+$/i.test(nm) ||
    /^task-\d+\.log$/i.test(nm) ||
    /^steps\/\d+\/output\.txt$/i.test(nm) ||
    nm.startsWith("/tmp/") ||
    nm.startsWith("/private/tmp/") ||
    nm.includes("/var/folders/") ||
    /^0x[0-9a-f]{8,}$/i.test(nm)
  ) {
    return true;
  }
  if (HALLUCINATION_ENTITY_REGEX.test(nm)) return true;
  if (CJK_REGEX.test(nm) && !CJK_CANONICAL_MAP.has(nm)) return true;
  return false;
}

function unescapeNestedXmlAttr(val) {
  let s = String(val || "");
  for (let i = 0; i < 8; i++) {
    const next = s
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&gt;/gi, ">")
      .replace(/&lt;/gi, "<")
      .replace(/&amp;/gi, "&");
    if (next === s) break;
    s = next;
  }
  s = normalizeUnicodeDashes(s);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXmlValue(val) {
  let s = String(val || "");
  for (let i = 0; i < 8; i++) {
    const next = s
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&gt;/gi, ">")
      .replace(/&lt;/gi, "<")
      .replace(/&amp;/gi, "&");
    if (next === s) break;
    s = next;
  }
  return normalizeUnicodeDashes(s);
}

function sanitizeObservationOrSummaryXml(xml) {
  let cleaned = xml.replace(/<file\b([^>]*)>([\s\S]*?)<\/file>/gi, (full, attrs, inner) => {
    const raw = unescapeXmlValue(inner);
    if (!raw || isNoisyScratchEntityName(raw)) return "";
    return `<file${attrs}>${escapeXml(raw)}</file>`;
  });
  cleaned = cleaned.replace(/<concept\b([^>]*)>([\s\S]*?)<\/concept>/gi, (full, attrs, inner) => {
    let raw = unescapeXmlValue(inner);
    if (CJK_CANONICAL_MAP.has(raw)) raw = CJK_CANONICAL_MAP.get(raw);
    if (!raw || isNoisyScratchEntityName(raw)) return "";
    return `<concept${attrs}>${escapeXml(raw)}</concept>`;
  });
  return cleaned;
}

function sanitizeGraphXmlOutput(xml) {
  const blockedNames = new Set();

  const sanitizeEntity = (attrs, body = null) => {
    const nameMatch = /\bname="([^"]*)"/i.exec(attrs);
    if (!nameMatch) return null;
    const rawDecoded = unescapeXmlValue(nameMatch[1]);
    const mapped = CJK_CANONICAL_MAP.has(rawDecoded)
      ? CJK_CANONICAL_MAP.get(rawDecoded)
      : rawDecoded;
    if (isNoisyScratchEntityName(mapped)) {
      blockedNames.add(nameMatch[1]);
      blockedNames.add(rawDecoded);
      blockedNames.add(mapped);
      return "";
    }
    const cleanAttrName = unescapeNestedXmlAttr(mapped);
    const updatedAttrs = attrs.replace(/\bname="([^"]*)"/i, `name="${cleanAttrName}"`);
    return body === null ? `<entity${updatedAttrs}/>` : `<entity${updatedAttrs}>${body}</entity>`;
  };

  const sanitizeRelationship = (attrs, body = null) => {
    const sMatch = /\bsource="([^"]*)"/i.exec(attrs);
    const tMatch = /\btarget="([^"]*)"/i.exec(attrs);
    if (!sMatch || !tMatch) return null;
    const sDecoded = unescapeXmlValue(sMatch[1]);
    const tDecoded = unescapeXmlValue(tMatch[1]);
    const sMapped = CJK_CANONICAL_MAP.has(sDecoded) ? CJK_CANONICAL_MAP.get(sDecoded) : sDecoded;
    const tMapped = CJK_CANONICAL_MAP.has(tDecoded) ? CJK_CANONICAL_MAP.get(tDecoded) : tDecoded;
    if (
      blockedNames.has(sMatch[1]) ||
      blockedNames.has(sDecoded) ||
      blockedNames.has(sMapped) ||
      blockedNames.has(tMatch[1]) ||
      blockedNames.has(tDecoded) ||
      blockedNames.has(tMapped) ||
      isNoisyScratchEntityName(sMapped) ||
      isNoisyScratchEntityName(tMapped)
    ) {
      return "";
    }
    const updatedAttrs = attrs
      .replace(/\bsource="([^"]*)"/i, `source="${unescapeNestedXmlAttr(sMapped)}"`)
      .replace(/\btarget="([^"]*)"/i, `target="${unescapeNestedXmlAttr(tMapped)}"`);
    return body === null
      ? `<relationship${updatedAttrs}/>`
      : `<relationship${updatedAttrs}>${body}</relationship>`;
  };

  // Clean <entity .../> and <entity ...>...</entity> tags and filter out scratch/hallucination entities
  let cleaned = String(xml || "").replace(/<entity(?=\s)([^>]*?)\/>/gi, (full, attrs) => {
    const res = sanitizeEntity(attrs, null);
    return res === null ? full : res;
  });

  cleaned = cleaned.replace(
    /<entity(?=\s)([^>]*[^/])>([\s\S]*?)<\/entity>/gi,
    (full, attrs, body) => {
      const res = sanitizeEntity(attrs, body);
      return res === null ? full : res;
    }
  );

  // Clean <relationship .../> and <relationship ...>...</relationship> tags and drop blocked edges
  cleaned = cleaned.replace(/<relationship(?=\s)([^>]*?)\/>/gi, (full, attrs) => {
    const res = sanitizeRelationship(attrs, null);
    return res === null ? full : res;
  });

  cleaned = cleaned.replace(
    /<relationship(?=\s)([^>]*[^/])>([\s\S]*?)<\/relationship>/gi,
    (full, attrs, body) => {
      const res = sanitizeRelationship(attrs, body);
      return res === null ? full : res;
    }
  );

  return cleaned;
}

function loadEnvFile() {
  const envPath = path.join(os.homedir(), ".agentmemory", ".env");
  const vars = {};
  try {
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).replace(/#.*$/, "").trim();
      vars[key] = val;
    }
  } catch {}
  return vars;
}

const envVars = loadEnvFile();
const PORT = Number(process.env.SMART_ROUTER_PORT || envVars.SMART_ROUTER_PORT || 3118);
const GROQ_KEY = process.env.GROQ_API_KEY || envVars.GROQ_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || envVars.GEMINI_API_KEY || "";

const TARGETS = [
  {
    name: "Gemini 3.8 Flash (Google AI Studio)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      Authorization: `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemini-3.8-flash",
    timeoutMs: 15000
  },
  {
    name: "Gemini Flash Latest (Google AI Studio - Accuracy Tier)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      Authorization: `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemini-flash-latest",
    timeoutMs: 15000
  },
  {
    name: "Groq (GPT-OSS 120B - Deep Reasoning)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json"
    },
    model: "openai/gpt-oss-120b",
    timeoutMs: 15000
  },
  {
    name: "Gemma 4 26B MoE (Google High-Quota Fast Pool)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      Authorization: `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemma-4-26b-a4b-it",
    timeoutMs: 15000
  },
  {
    name: "Gemini 3.1 Flash Lite (Google AI Studio)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      Authorization: `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemini-3.1-flash-lite-preview",
    timeoutMs: 12000
  },
  {
    name: "Gemini Flash Lite (Google AI Studio - Fast Quota)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      Authorization: `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemini-flash-lite-latest",
    timeoutMs: 12000
  },
  {
    name: "Groq (GPT-OSS 20B - Super Fast & High Quota)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json"
    },
    model: "openai/gpt-oss-20b",
    timeoutMs: 12000
  },
  {
    name: "Groq (Qwen 3.8 27B - Multilingual)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: {
      Authorization: `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json"
    },
    model: "qwen/qwen3.8-27b",
    timeoutMs: 12000
  },
  {
    name: "Z Fold 3 (Local USB)",
    url: "http://127.0.0.1:8080/v1/chat/completions",
    headers: {
      "Content-Type": "application/json"
    },
    model: "qwen2.5-3b-instruct",
    timeoutMs: 4000
  },
  {
    name: "Z Fold 3 (Local Wi-Fi)",
    url: "http://192.168.1.231:8080/v1/chat/completions",
    headers: {
      "Content-Type": "application/json"
    },
    model: "qwen2.5-3b-instruct",
    timeoutMs: 4000
  }
];

const FAST_MODEL_ORDER = [
  "gemini-3.1-flash-lite-preview",
  "gemini-flash-lite-latest",
  "openai/gpt-oss-20b",
  "gemma-4-26b-a4b-it",
  "qwen/qwen3.8-27b",
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "openai/gpt-oss-120b",
  "qwen2.5-3b-instruct"
];

const ACCURACY_MODEL_ORDER = [
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "openai/gpt-oss-120b",
  "gemma-4-26b-a4b-it",
  "gemini-3.1-flash-lite-preview",
  "gemini-flash-lite-latest",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "qwen2.5-3b-instruct"
];

/**
 * Selects and orders target tiers based on task format:
 * - "observation" / "any": fast, high-quota tier order first
 * - "summary" / "graph" / "entities": accuracy-first tier order
 */
function selectTargetsForFormat(expectedFormat = "any", targets = TARGETS) {
  const list = Array.isArray(targets) ? [...targets] : [...TARGETS];
  const normalized = String(expectedFormat || "any")
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, "");
  const useAccuracyTier =
    normalized === "summary" ||
    normalized === "graph" ||
    normalized === "entities" ||
    normalized === "temporal_graph";
  const order = useAccuracyTier ? ACCURACY_MODEL_ORDER : FAST_MODEL_ORDER;
  const rankMap = new Map(order.map((model, idx) => [model, idx]));
  return list.sort((a, b) => {
    const ra = rankMap.has(a?.model) ? rankMap.get(a.model) : Number.MAX_SAFE_INTEGER;
    const rb = rankMap.has(b?.model) ? rankMap.get(b.model) : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

const cooldownUntil = new Map();

function isCoolingDown(target) {
  const until = cooldownUntil.get(target.name) || 0;
  return Date.now() < until;
}

function markCooldown(target, status, errText = "") {
  let ms = 45000;
  if (status === 429 && (errText.includes("tokens per day") || errText.includes("PerDay"))) {
    ms = 10 * 60 * 1000;
  } else if (status === 499) {
    ms = 15 * 1000;
  } else if (
    target.url.includes("127.0.0.1:8080") ||
    target.url.includes("192.168.1.231:8080")
  ) {
    ms = 120 * 1000;
  }
  cooldownUntil.set(target.name, Date.now() + ms);
}

/**
 * Surrogate-safe UTF-16 string slicing (#1598)
 */
function sliceHeadSurrogateSafe(str, maxLen) {
  if (typeof str !== "string" || str.length <= maxLen) return str;
  let end = maxLen;
  if (end > 0) {
    const code = str.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return str.slice(0, end);
}

function sliceTailSurrogateSafe(str, maxLen) {
  if (typeof str !== "string" || str.length <= maxLen) return str;
  let start = str.length - maxLen;
  if (start < str.length) {
    const code = str.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff) start += 1;
  }
  return str.slice(start);
}

function sanitizeForTarget(payload) {
  if (!payload || !Array.isArray(payload.messages)) return payload;

  const MAX_TOTAL_CHARS = 12000;
  const totalChars = payload.messages.reduce(
    (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
    0
  );
  if (totalChars <= MAX_TOTAL_CHARS) return payload;

  const messages = payload.messages.map((m) => {
    if (typeof m.content !== "string" || m.content.length <= 4000) return m;
    const keepHead = 3500;
    const keepTail = 4500;
    const content =
      sliceHeadSurrogateSafe(m.content, keepHead) +
      "\n\n...[trimmed middle observations to stay within rate & latency limits]...\n\n" +
      sliceTailSurrogateSafe(m.content, keepTail);
    return { ...m, content };
  });

  return { ...payload, messages };
}

function escapeXmlBareAmpersands(xml) {
  return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, "&amp;");
}

/**
 * Cleans LLM output, strips hallucinations/scratch noise, and detects truncated replies (#1495).
 */
function inspectAndCleanResponse(rawText, expectedFormat = "any") {
  try {
    const obj = JSON.parse(rawText);
    if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
      return { ok: false, reason: "empty_choices" };
    }

    const fmt = String(expectedFormat || "any").trim().toLowerCase().replace(/^<|>$/g, "");
    const normalizedFormat = fmt === "entities" || fmt === "temporal_graph" ? "graph" : fmt;

    for (const c of obj.choices) {
      const finishReason = c?.finish_reason;
      const rawContent = typeof c?.message?.content === "string" ? c.message.content : "";

      let text = rawContent
        .replace(
          /<(?:thought|think)>[\s\S]*?(?:<\/(?:thought|think)>|(?=<(?:summary|observation|entities)>))/gi,
          ""
        )
        .trim();

      if (finishReason === "length") {
        const hasCompleteSummary = /<summary>[\s\S]*?<\/summary>/i.test(text);
        const hasCompleteObs = /<observation>[\s\S]*?<\/observation>/i.test(text);
        const hasCompleteGraph = /<entities>[\s\S]*?<\/relationships>/i.test(text);
        if (!hasCompleteSummary && !hasCompleteObs && !hasCompleteGraph) {
          return { ok: false, reason: "finish_reason_length_truncated" };
        }
      }

      if (!text) {
        return { ok: false, reason: "empty_content_after_think_strip" };
      }

      if (
        normalizedFormat === "summary" &&
        /<summary>/i.test(text) &&
        !/<\/summary>/i.test(text)
      ) {
        return { ok: false, reason: "unclosed_summary_xml" };
      }
      if (
        normalizedFormat === "observation" &&
        /<observation>/i.test(text) &&
        !/<\/observation>/i.test(text)
      ) {
        return { ok: false, reason: "unclosed_observation_xml" };
      }
      if (
        normalizedFormat === "graph" &&
        /<entities>/i.test(text) &&
        !/<\/relationships>/i.test(text)
      ) {
        return { ok: false, reason: "unclosed_graph_xml" };
      }

      if (/<summary>/i.test(text)) {
        const m = text.match(/<summary>[\s\S]*?<\/summary>/i);
        if (m) text = m[0];
        text = sanitizeObservationOrSummaryXml(escapeXmlBareAmpersands(text));
      } else if (/<observation>/i.test(text)) {
        const m = text.match(/<observation>[\s\S]*?<\/observation>/i);
        if (m) text = m[0];
        text = sanitizeObservationOrSummaryXml(escapeXmlBareAmpersands(text));
      } else if (/<entities>/i.test(text)) {
        const m = text.match(/<entities>[\s\S]*?<\/relationships>/i);
        if (m) text = m[0];
        text = sanitizeGraphXmlOutput(escapeXmlBareAmpersands(text));
      }

      c.message.content = text.trim();
      c.finish_reason = "stop";
    }

    return { ok: true, data: JSON.stringify(obj) };
  } catch (err) {
    return { ok: false, reason: `invalid_json: ${err.message}` };
  }
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
}

function detectExpectedFormat(systemMsg = "") {
  const sys = String(systemMsg || "");
  if (
    sys.includes("<summary>") ||
    sys.includes("session summarizer") ||
    sys.includes("merging multiple partial summaries")
  ) {
    return "summary";
  }
  if (sys.includes("<observation>")) {
    return "observation";
  }
  if (sys.includes("knowledge graph extraction") || sys.includes("<entities>")) {
    return "graph";
  }
  return "any";
}

function normalizeTextLinesPreserveNewlines(text) {
  return String(text || "")
    .split("\n")
    .map((line) =>
      line
        .normalize("NFKC")
        .replace(/[\u2010-\u2015\u2212\u00ad]/g, "-")
        .replace(/[\u200b-\u200d\ufeff]/g, "")
    )
    .join("\n");
}

function stripUrlsForExtraction(text) {
  return String(text || "")
    .replace(/file:\/\/\//gi, "/")
    .replace(/https?:\/\/[^\s"'`<>()[\]{}]+/gi, " ");
}

function addCleanFileCandidate(files, seenLower, rawCandidate, limit, allowBareFilename = false) {
  if (files.length >= limit) return;
  const candidate = normalizeUnicodeDashes(
    String(rawCandidate || "")
      .trim()
      .replace(/^["'`(<[{]+/, "")
      .replace(/[.,;:!?)\]}'">`]+$/, "")
  );
  if (!candidate || candidate.length < 3 || candidate.length > 260) return;
  if (/^(?:none|null|undefined|n\/a|na|true|false)$/i.test(candidate)) return;
  if (/^\/[^/]+\/[gimsuvy]*$/.test(candidate)) return;
  if (allowBareFilename) {
    if (!candidate.includes("/") && !/^[a-zA-Z0-9_.-]+\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(candidate)) {
      return;
    }
  } else if (!candidate.includes("/")) {
    return;
  }
  if (isNoisyScratchEntityName(candidate)) return;
  const key = candidate.toLowerCase();
  if (seenLower.has(key)) return;
  seenLower.add(key);
  files.push(candidate);
}

function extractCleanFilesFromText(text, maxFiles = 12) {
  const normalizedText = normalizeTextLinesPreserveNewlines(text);
  const files = [];
  const seenLower = new Set();

  // 1. Explicit "Files:" lines (comma-separated, supports bare filenames like install.sh)
  for (const m of normalizedText.matchAll(/(?:^|\n)\s*Files:\s*([^\n]+)/gi)) {
    for (const part of m[1].split(",")) {
      addCleanFileCandidate(files, seenLower, part, maxFiles, true);
    }
  }

  let working = stripUrlsForExtraction(normalizedText);

  // 2. Quoted JSON / key-value file fields (mask matched values so substrings aren't re-matched)
  working = working.replace(
    /(?:"(?:file_?path|target_?file|source_?file|path|file|files)"|file_?path|target_?file|source_?file|path|file)\s*[:=]\s*["']([^"'\n]+)["']/gi,
    (full, val) => {
      addCleanFileCandidate(files, seenLower, val, maxFiles, true);
      return " ";
    }
  );

  // 3. Absolute or home-relative paths (e.g. /Users/.../app.mjs or ~/.agentmemory/graph.json)
  working = working.replace(
    /(?:^|[\s"'`(\[:=,])((?:~\/|\/[a-zA-Z0-9._@-]+\/)[a-zA-Z0-9._/@-]+)/g,
    (full, candidate) => {
      addCleanFileCandidate(files, seenLower, candidate, maxFiles, false);
      return full.slice(0, full.length - candidate.length) + " ";
    }
  );

  // 4. Relative paths with file extension (e.g. router/smart-router.mjs)
  for (const m of working.matchAll(
    /(?:^|[\s"'`(\[:=,])((?:\.\.?\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z][a-zA-Z0-9]{0,9})/g
  )) {
    addCleanFileCandidate(files, seenLower, m[1], maxFiles, false);
  }

  return files;
}

const GENERIC_CONCEPT_SKIP = new Set([
  "file_path",
  "target_file",
  "source_file",
  "tool_name",
  "tool_input",
  "tool_output",
  "user_prompt",
  "assistant_response",
  "finish_reason",
  "max_tokens",
  "content-type",
  "application-json",
  "utf-8",
  "post_tool_use",
  "pre_tool_use",
  "prompt_submit",
  "session_start",
  "session_end",
  "pre_compact",
  "subagent_start",
  "subagent_stop",
  "task_completed",
  "operation"
]);

const FILE_EXT_CONCEPT_REGEX =
  /\.(?:mjs|cjs|js|jsx|ts|tsx|py|go|rs|java|rb|php|sh|zsh|md|txt|log|json|yaml|yml|toml|xml|html|css|sql|env|lock|plist|png|jpg|jpeg|webp|pdf)$/i;

const KNOWN_DOMAIN_CONCEPTS = [
  [/\bAgentMemory\b/i, "AgentMemory"],
  [/\bSmart\s+AI\s+Router\b/i, "Smart AI Router"],
  [/\bSmart\s+Router\b/i, "Smart Router"],
  [/\bNode\.js\b/i, "Node.js"],
  [/\bTypeScript\b/i, "TypeScript"],
  [/\bJavaScript\b/i, "JavaScript"],
  [/\bGraphQL\b/i, "GraphQL"],
  [/\bDocker\b/i, "Docker"],
  [/\bRedis\b/i, "Redis"],
  [/\bReact\b/i, "React"],
  [/\bGemini\b/i, "Gemini"],
  [/\bGemma\b/i, "Gemma"],
  [/\bGroq\b/i, "Groq"],
  [/\bOllama\b/i, "Ollama"],
  [/\bXML\b/, "XML"],
  [/\bJSON\b/, "JSON"],
  [/\bHTTP\b/, "HTTP"],
  [/\bESM\b/, "ESM"],
  [/\bCLI\b/, "CLI"],
  [/\bAPI\b/, "API"],
  [/\bMCP\b/, "MCP"],
  [/\bSQL\b/, "SQL"],
  [/\bKV\b/, "KV"],
  [/\bNFKC\b/, "NFKC"],
  [/\bUTF-16\b/i, "UTF-16"]
];

function addCleanConceptCandidate(
  concepts,
  seenLower,
  rawCandidate,
  limit,
  { allowFileExtension = false } = {}
) {
  if (concepts.length >= limit) return;
  let c = normalizeUnicodeDashes(String(rawCandidate || "").replace(/^["'`]+|["'`]+$/g, ""));
  if (CJK_CANONICAL_MAP.has(c)) c = CJK_CANONICAL_MAP.get(c);
  if (!c || c.length < 2 || c.length > 60) return;
  if (/^\d+$/.test(c)) return;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return;
  if (/^[0-9a-f]{4,}(?:-[0-9a-f]{4,})+$/i.test(c)) return;
  if (/^[0-9a-f]{8,}$/i.test(c)) return;
  if (c.startsWith("/") || c.startsWith("~/") || c.startsWith("./") || c.startsWith("../")) return;
  if (!allowFileExtension && (c.includes("/") || FILE_EXT_CONCEPT_REGEX.test(c))) return;
  if (GENERIC_CONCEPT_SKIP.has(c.toLowerCase())) return;
  if (isNoisyScratchEntityName(c)) return;
  const key = c.toLowerCase();
  if (seenLower.has(key)) return;
  seenLower.add(key);
  concepts.push(c);
}

function extractCleanConceptsFromText(
  text,
  { toolName = "", maxConcepts = 8, fallbackConcepts = [] } = {}
) {
  const normalizedText = normalizeTextLinesPreserveNewlines(text);
  const concepts = [];
  const seenLower = new Set();

  // 1. Explicit "Concepts:" lines
  for (const m of normalizedText.matchAll(/(?:^|\n)\s*Concepts:\s*([^\n]+)/gi)) {
    for (const part of m[1].split(",")) {
      addCleanConceptCandidate(concepts, seenLower, part, maxConcepts, { allowFileExtension: true });
    }
  }

  // 2. Strip metadata headers, URLs, and noisy scratch paths before scanning content keywords
  const stripped = stripUrlsForExtraction(normalizedText)
    .replace(/^(?:Timestamp|Hook|Tool|Files|Concepts):[^\n]*$/gim, " ")
    .replace(/(?:~\/|\/[a-zA-Z0-9._@-]+\/)[a-zA-Z0-9._/@-]+/g, " ");

  // 3. Backticked technical identifiers
  for (const m of stripped.matchAll(/`([^`\n]{2,48})`/g)) {
    const token = m[1].trim();
    if (token.split(/\s+/).length <= 3) {
      addCleanConceptCandidate(concepts, seenLower, token, maxConcepts);
    }
  }

  // 4. Compound technical identifiers (kebab-case / snake_case)
  for (const m of stripped.matchAll(/\b([a-zA-Z][a-zA-Z0-9]*(?:[-_][a-zA-Z0-9]+)+)\b/g)) {
    addCleanConceptCandidate(concepts, seenLower, m[1], maxConcepts);
  }

  // 5. Well-known coding / architecture domain terms present in text
  for (const [pattern, label] of KNOWN_DOMAIN_CONCEPTS) {
    if (concepts.length >= maxConcepts) break;
    if (pattern.test(stripped)) {
      addCleanConceptCandidate(concepts, seenLower, label, maxConcepts, { allowFileExtension: true });
    }
  }

  // 6. Tool name if explicitly provided and non-generic
  if (toolName && concepts.length < maxConcepts) {
    addCleanConceptCandidate(concepts, seenLower, toolName, maxConcepts);
  }

  // 7. Optional caller-supplied fallback concepts (only for <summary>, never fake <observation> defaults)
  if (concepts.length === 0 && Array.isArray(fallbackConcepts)) {
    for (const fc of fallbackConcepts) {
      addCleanConceptCandidate(concepts, seenLower, fc, maxConcepts);
    }
  }

  return concepts;
}

function buildLocalExtractiveFallback(parsed) {
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMsg =
    messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n") || "";
  const format = detectExpectedFormat(systemMsg);

  let content = "";

  if (format === "summary") {
    const titles = [];
    for (const m of userMsg.matchAll(/(?:\[\d+\]\s+[a-z_]+:\s+|Title:\s+)([^\n]+)/gi)) {
      const t = normalizeUnicodeDashes(m[1]);
      if (t && t.length > 3 && !titles.includes(t)) titles.push(t);
    }
    const files = extractCleanFilesFromText(userMsg, 12);
    const concepts = extractCleanConceptsFromText(userMsg, {
      maxConcepts: 8,
      fallbackConcepts: ["session-summary", "agentmemory", "system-configuration"]
    });

    const mainTitle = sliceHeadSurrogateSafe(
      titles[titles.length - 1] || titles[0] || "Coding & System Optimization Session",
      95
    );
    const sampleTitles =
      titles.slice(-6).join("; ") ||
      "Executed project tasks, diagnostics, and configuration updates";
    const narrative = `Completed session activities across ${
      titles.length || 1
    } key milestones: ${sampleTitles}. All observations and state changes were captured and indexed in AgentMemory.`;
    const decisionList = (
      titles.slice(0, 4).length
        ? titles.slice(0, 4)
        : ["Completed automated session state verification and memory indexing"]
    )
      .map((d) => `    <decision>${escapeXml(sliceHeadSurrogateSafe(d, 140))}</decision>`)
      .join("\n");
    const filesXml = files.length
      ? `<files>\n${files.map((f) => `    <file>${escapeXml(f)}</file>`).join("\n")}\n  </files>`
      : `<files></files>`;
    const conceptsXml = concepts.length
      ? `<concepts>\n${concepts.map((c) => `    <concept>${escapeXml(c)}</concept>`).join("\n")}\n  </concepts>`
      : `<concepts></concepts>`;

    content = `<summary>
  <title>${escapeXml(mainTitle)}</title>
  <narrative>${escapeXml(narrative)}</narrative>
  <decisions>
${decisionList}
  </decisions>
  ${filesXml}
  ${conceptsXml}
</summary>`;
  } else if (format === "observation") {
    const normalizedUserMsg = normalizeTextLinesPreserveNewlines(userMsg);
    const toolMatch = /Tool:\s*([^\n]+)/i.exec(normalizedUserMsg);
    const hookMatch = /Hook:\s*([^\n]+)/i.exec(normalizedUserMsg);
    const toolName = normalizeUnicodeDashes(
      toolMatch ? toolMatch[1] : hookMatch ? hookMatch[1] : "operation"
    );
    let obsType = "other";
    if (/read|view/i.test(toolName)) obsType = "file_read";
    else if (/write|create/i.test(toolName)) obsType = "file_write";
    else if (/edit|replace/i.test(toolName)) obsType = "file_edit";
    else if (/run|command|bash|exec/i.test(toolName)) obsType = "command_run";
    else if (/search|grep|find/i.test(toolName)) obsType = "search";
    else if (/prompt/i.test(toolName)) obsType = "conversation";

    const firstLine = normalizeUnicodeDashes(
      normalizedUserMsg
        .split("\n")
        .map((l) => l.trim())
        .find(
          (l) =>
            l.length > 15 &&
            !l.startsWith("Timestamp:") &&
            !l.startsWith("Hook:") &&
            !l.startsWith("Tool:")
        ) || `Executed ${toolName}`
    );
    const title = sliceHeadSurrogateSafe(`${toolName}: ${firstLine}`, 75);
    const narrative = `Executed ${toolName} during coding session (${sliceHeadSurrogateSafe(
      firstLine,
      120
    )}). Output was captured and indexed for session memory retrieval.`;

    const files = extractCleanFilesFromText(userMsg, 8);
    const concepts = extractCleanConceptsFromText(userMsg, {
      toolName: toolMatch || hookMatch ? toolName : "",
      maxConcepts: 6
    });

    const conceptsXml = concepts.length
      ? `<concepts>\n${concepts.map((c) => `    <concept>${escapeXml(c)}</concept>`).join("\n")}\n  </concepts>`
      : `<concepts></concepts>`;
    const filesXml = files.length
      ? `<files>\n${files.map((f) => `    <file>${escapeXml(f)}</file>`).join("\n")}\n  </files>`
      : `<files></files>`;

    content = `<observation>
  <type>${obsType}</type>
  <title>${escapeXml(title)}</title>
  <subtitle>${escapeXml(toolName)}</subtitle>
  <facts>
    <fact>${escapeXml(sliceHeadSurrogateSafe(firstLine, 160))}</fact>
    <fact>Processed via ${escapeXml(toolName)}</fact>
  </facts>
  <narrative>${escapeXml(narrative)}</narrative>
  ${conceptsXml}
  ${filesXml}
  <importance>5</importance>
</observation>`;
  } else {
    content = "OK";
  }

  return JSON.stringify({
    id: `chatcmpl-local-fallback-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "smart-router-extractive-fallback",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 100,
      total_tokens: 200
    }
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
    const fastChain = [
      ...selectTargetsForFormat("observation").map((t) => `${t.name} [${t.model}]`),
      "Local Extractive Fallback (Zero-Fail Safety Net)"
    ];
    const accuracyChain = [
      ...selectTargetsForFormat("summary").map((t) => `${t.name} [${t.model}]`),
      "Local Extractive Fallback (Zero-Fail Safety Net)"
    ];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        version: "4.0",
        features: [
          "task-aware-model-tiering (fast-observation vs accuracy-summary-graph)",
          "surrogate-safe-truncation (#1598)",
          "max_tokens-truncated-reply-failover (#1495)",
          "zero-token-hallucination-and-scratch-noise-gate",
          "observation-summary-xml-sanitization",
          "nested-xml-entity-unescaping",
          "direct-graph-xml-zero-token-passthrough",
          "maintenance-lock-graph-freeze"
        ],
        chains: {
          fast: fastChain,
          accuracy: accuracyChain
        },
        chain: accuracyChain
      })
    );
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const sanitized = sanitizeForTarget(parsed);

  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const allUserText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content || "")
    .join("\n");

  const expectedFormat = detectExpectedFormat(systemMsg);
  const isSummarize = expectedFormat === "summary";
  const isGraphExtraction = expectedFormat === "graph";

  const isMaintenanceLocked = fs.existsSync(MAINTENANCE_LOCK_PATH);

  // If maintenance lock is active, freeze background LLM graph extraction (0 tokens, 0ms)
  if (isMaintenanceLocked && isGraphExtraction && !allUserText.includes("DIRECT_GRAPH_XML")) {
    console.log("🔒 [Smart Router] Maintenance Lock active: Blocked background graph extraction prompt (0 tokens, 0ms)");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: `chatcmpl-maintenance-locked-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "maintenance-lock-frozen",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "<entities>\n</entities>\n<relationships>\n</relationships>"
            },
            finish_reason: "stop"
          }
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      })
    );
    return;
  }

  if (!isSummarize && isGraphExtraction && allUserText.includes("DIRECT_GRAPH_XML")) {
    const xmlMatch = allUserText.match(/<entities>[\s\S]*?<\/relationships>/);
    if (xmlMatch) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: `chatcmpl-direct-graph-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "direct-graph-xml-passthrough",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: xmlMatch[0] },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        })
      );
      return;
    }
  }

  const selectedTargets = selectTargetsForFormat(expectedFormat);

  for (const target of selectedTargets) {
    if (isCoolingDown(target)) continue;
    try {
      const payload = { ...sanitized, model: target.model };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), target.timeoutMs || 15000);

      const response = await fetch(target.url, {
        method: "POST",
        headers: target.headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.ok) {
        const rawText = await response.text();
        const inspected = inspectAndCleanResponse(rawText, expectedFormat);
        if (inspected.ok) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(inspected.data);
          return;
        }
        markCooldown(target, 499, inspected.reason);
        console.log(
          `[Router] ${target.name} rejected (${inspected.reason}) -> failing over to next tier...`
        );
        continue;
      }
      const errText = await response.text();
      markCooldown(target, response.status, errText);
      console.log(
        `[Router] ${target.name} returned ${response.status} (cooling down): ${sliceHeadSurrogateSafe(
          errText,
          140
        )}`
      );
    } catch (err) {
      markCooldown(target, 0, err.message);
      console.log(
        `[Router] ${target.name} unreachable (${err.message}), cooling down & falling back...`
      );
    }
  }

  console.log(
    "[Router] All remote/local LLM targets cooling down -> using Zero-Fail Local Extractive Fallback!"
  );
  const fallbackData = buildLocalExtractiveFallback(sanitized);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(fallbackData);
});

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Smart AI Router v4.0 listening on http://127.0.0.1:${PORT}`);
  });
}

export {
  normalizeUnicodeDashes,
  isNoisyScratchEntityName,
  sanitizeObservationOrSummaryXml,
  sanitizeGraphXmlOutput,
  inspectAndCleanResponse,
  buildLocalExtractiveFallback,
  selectTargetsForFormat,
  TARGETS,
  FAST_MODEL_ORDER,
  ACCURACY_MODEL_ORDER
};
