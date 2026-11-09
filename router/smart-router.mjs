import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * AgentMemory 11-Tier Fault-Tolerant Smart AI Router (v3.0)
 * - Surrogate-safe UTF-16 prompt & fallback slicing (#1598)
 * - Truncated reply (finish_reason === "length" / unclosed XML) detection & automatic tier failover (#1495)
 * - Zero-Token Hallucination & Scratch Noise Gate on <entities> XML
 * - Nested XML entity unescaping so &amp;quot; / &amp;lt; phantoms never enter the graph
 * - Instant Zero-Token DIRECT_GRAPH_XML passthrough (<1ms)
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

function isNoisyScratchEntityName(name) {
  const nm = String(name || "").trim();
  if (!nm) return true;
  if (
    nm.includes("/.system_generated/tasks/") ||
    nm.includes("/.system_generated/steps/") ||
    nm.includes("/.user_uploaded/media_") ||
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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeGraphXmlOutput(xml) {
  const blockedNames = new Set();
  // Clean <entity .../> tags and filter out scratch/hallucination entities
  let cleaned = xml.replace(/<entity\b([^>]*?)\/>/gi, (full, attrs) => {
    const nameMatch = /\bname="([^"]*)"/i.exec(attrs);
    if (!nameMatch) return full;
    let cleanAttrName = unescapeNestedXmlAttr(nameMatch[1]);
    if (CJK_CANONICAL_MAP.has(cleanAttrName)) {
      cleanAttrName = CJK_CANONICAL_MAP.get(cleanAttrName);
    }
    if (isNoisyScratchEntityName(cleanAttrName)) {
      blockedNames.add(nameMatch[1]);
      blockedNames.add(cleanAttrName);
      return "";
    }
    return full.replace(/\bname="([^"]*)"/i, `name="${cleanAttrName}"`);
  });

  // Clean <relationship .../> tags and drop relationships referencing blocked entities
  cleaned = cleaned.replace(/<relationship\b([^>]*?)\/>/gi, (full, attrs) => {
    const sMatch = /\bsource="([^"]*)"/i.exec(attrs);
    const tMatch = /\btarget="([^"]*)"/i.exec(attrs);
    if (!sMatch || !tMatch) return full;
    let sClean = unescapeNestedXmlAttr(sMatch[1]);
    let tClean = unescapeNestedXmlAttr(tMatch[1]);
    if (CJK_CANONICAL_MAP.has(sClean)) sClean = CJK_CANONICAL_MAP.get(sClean);
    if (CJK_CANONICAL_MAP.has(tClean)) tClean = CJK_CANONICAL_MAP.get(tClean);
    if (
      blockedNames.has(sMatch[1]) ||
      blockedNames.has(sClean) ||
      blockedNames.has(tMatch[1]) ||
      blockedNames.has(tClean) ||
      isNoisyScratchEntityName(sClean) ||
      isNoisyScratchEntityName(tClean)
    ) {
      return "";
    }
    return full
      .replace(/\bsource="([^"]*)"/i, `source="${sClean}"`)
      .replace(/\btarget="([^"]*)"/i, `target="${tClean}"`);
  });

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
    name: "Gemini 2.5 Flash (Google AI Studio - Stable)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      Authorization: `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemini-2.5-flash",
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
        expectedFormat === "summary" &&
        text.includes("<summary>") &&
        !/<\/summary>/i.test(text)
      ) {
        return { ok: false, reason: "unclosed_summary_xml" };
      }
      if (
        expectedFormat === "observation" &&
        text.includes("<observation>") &&
        !/<\/observation>/i.test(text)
      ) {
        return { ok: false, reason: "unclosed_observation_xml" };
      }
      if (
        expectedFormat === "graph" &&
        text.includes("<entities>") &&
        !/<\/relationships>/i.test(text)
      ) {
        return { ok: false, reason: "unclosed_graph_xml" };
      }

      if (text.includes("<summary>")) {
        const m = text.match(/<summary>[\s\S]*?<\/summary>/i);
        if (m) text = m[0];
        text = escapeXmlBareAmpersands(text);
      } else if (text.includes("<observation>")) {
        const m = text.match(/<observation>[\s\S]*?<\/observation>/i);
        if (m) text = m[0];
        text = escapeXmlBareAmpersands(text);
      } else if (text.includes("<entities>")) {
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

function buildLocalExtractiveFallback(parsed) {
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMsg =
    messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n") || "";

  let content = "";

  if (
    systemMsg.includes("<summary>") ||
    systemMsg.includes("session summarizer") ||
    systemMsg.includes("merging multiple partial summaries")
  ) {
    const titles = [];
    for (const m of userMsg.matchAll(/(?:\[\d+\]\s+[a-z_]+:\s+|Title:\s+)([^\n]+)/gi)) {
      const t = m[1].trim();
      if (t && t.length > 3 && !titles.includes(t)) titles.push(t);
    }
    const files = [];
    for (const m of userMsg.matchAll(
      /(?:Files:\s*|-\s*)(\/[^\s,\n]+|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/g
    )) {
      const f = m[1].trim();
      if (f && !files.includes(f) && !isNoisyScratchEntityName(f)) files.push(f);
    }
    const concepts = [];
    for (const m of userMsg.matchAll(/Concepts:\s*([^\n]+)/gi)) {
      for (const c of m[1].split(",")) {
        const clean = c.trim();
        if (clean && !concepts.includes(clean) && !isNoisyScratchEntityName(clean))
          concepts.push(clean);
      }
    }

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
    const fileList = (files.slice(0, 12).length ? files.slice(0, 12) : ["~/.agentmemory/.env"])
      .map((f) => `    <file>${escapeXml(f)}</file>`)
      .join("\n");
    const conceptList = (
      concepts.slice(0, 8).length
        ? concepts.slice(0, 8)
        : ["session-summary", "agentmemory", "system-configuration"]
    )
      .map((c) => `    <concept>${escapeXml(c)}</concept>`)
      .join("\n");

    content = `<summary>
  <title>${escapeXml(mainTitle)}</title>
  <narrative>${escapeXml(narrative)}</narrative>
  <decisions>
${decisionList}
  </decisions>
  <files>
${fileList}
  </files>
  <concepts>
${conceptList}
  </concepts>
</summary>`;
  } else if (systemMsg.includes("<observation>")) {
    const toolMatch = /Tool:\s*([^\n]+)/i.exec(userMsg);
    const hookMatch = /Hook:\s*([^\n]+)/i.exec(userMsg);
    const toolName = toolMatch
      ? toolMatch[1].trim()
      : hookMatch
      ? hookMatch[1].trim()
      : "operation";
    let obsType = "other";
    if (/read|view/i.test(toolName)) obsType = "file_read";
    else if (/write|create/i.test(toolName)) obsType = "file_write";
    else if (/edit|replace/i.test(toolName)) obsType = "file_edit";
    else if (/run|command|bash|exec/i.test(toolName)) obsType = "command_run";
    else if (/search|grep|find/i.test(toolName)) obsType = "search";
    else if (/prompt/i.test(toolName)) obsType = "conversation";

    const firstLine =
      userMsg
        .split("\n")
        .map((l) => l.trim())
        .find(
          (l) =>
            l.length > 15 &&
            !l.startsWith("Timestamp:") &&
            !l.startsWith("Hook:") &&
            !l.startsWith("Tool:")
        ) || `Executed ${toolName}`;
    const title = sliceHeadSurrogateSafe(`${toolName}: ${firstLine}`, 75);
    const narrative = `Executed ${toolName} during coding session (${sliceHeadSurrogateSafe(
      firstLine,
      120
    )}). Output was captured and indexed for session memory retrieval.`;

    content = `<observation>
  <type>${obsType}</type>
  <title>${escapeXml(title)}</title>
  <subtitle>${escapeXml(toolName)}</subtitle>
  <facts>
    <fact>${escapeXml(sliceHeadSurrogateSafe(firstLine, 160))}</fact>
    <fact>Processed via ${escapeXml(toolName)}</fact>
  </facts>
  <narrative>${escapeXml(narrative)}</narrative>
  <concepts>
    <concept>${escapeXml(toolName)}</concept>
    <concept>agent-workflow</concept>
  </concepts>
  <files>
    <file>~/.agentmemory/.env</file>
  </files>
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
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        version: "3.0",
        features: [
          "surrogate-safe-truncation (#1598)",
          "max_tokens-truncated-reply-failover (#1495)",
          "zero-token-hallucination-and-scratch-noise-gate",
          "nested-xml-entity-unescaping",
          "direct-graph-xml-zero-token-passthrough"
        ],
        chain: [...TARGETS.map((t) => t.name), "Local Extractive Fallback (Zero-Fail Safety Net)"]
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

  const isSummarize =
    systemMsg.includes("<summary>") ||
    systemMsg.includes("session summarizer") ||
    systemMsg.includes("merging multiple partial summaries");
  const isObservation = systemMsg.includes("<observation>");
  const isGraphExtraction =
    systemMsg.includes("knowledge graph extraction") || systemMsg.includes("<entities>");
  const expectedFormat = isSummarize
    ? "summary"
    : isObservation
    ? "observation"
    : isGraphExtraction
    ? "graph"
    : "any";

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

  for (const target of TARGETS) {
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

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Smart AI Router v3.0 listening on http://127.0.0.1:${PORT}`);
});
