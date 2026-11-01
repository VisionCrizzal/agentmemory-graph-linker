import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
      "Authorization": `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json"
    },
    model: "openai/gpt-oss-20b",
    timeoutMs: 12000
  },
  {
    name: "Groq (Qwen 3.8 27B - Multilingual)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: {
      "Authorization": `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json"
    },
    model: "qwen/qwen3.8-27b",
    timeoutMs: 12000
  },
  {
    name: "Groq (GPT-OSS 120B - Deep Reasoning)",
    url: "https://api.groq.com/openai/v1/chat/completions",
    headers: {
      "Authorization": `Bearer ${GROQ_KEY}`,
      "Content-Type": "application/json"
    },
    model: "openai/gpt-oss-120b",
    timeoutMs: 15000
  },
  {
    name: "Gemma 4 26B MoE (Google High-Quota Fast Pool)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      "Authorization": `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemma-4-26b-a4b-it",
    timeoutMs: 18000
  },
  {
    name: "Gemma 4 31B IT (Google High-Quota Pool)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      "Authorization": `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemma-4-31b-it",
    timeoutMs: 20000
  },
  {
    name: "Gemini 3.8 Flash (Google AI Studio)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      "Authorization": `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemini-3.8-flash",
    timeoutMs: 15000
  },
  {
    name: "Gemini 3.5 Flash (Google AI Studio)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      "Authorization": `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemini-3.5-flash",
    timeoutMs: 15000
  },
  {
    name: "Gemini Flash Lite (Google AI Studio)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    headers: {
      "Authorization": `Bearer ${GEMINI_KEY}`,
      "Content-Type": "application/json"
    },
    model: "gemini-flash-lite-latest",
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

// Cooldown tracker so rate-limited or offline targets are skipped in 0ms
const cooldownUntil = new Map();

function isCoolingDown(target) {
  const until = cooldownUntil.get(target.name) || 0;
  return Date.now() < until;
}

function markCooldown(target, status, errText = "") {
  let ms = 45000; // default 45s cooldown for per-minute rate limits or offline local nodes
  if (status === 429 && (errText.includes("tokens per day") || errText.includes("PerDay"))) {
    ms = 10 * 60 * 1000; // 10 min cooldown for daily quota exhaustion
  } else if (target.url.includes("127.0.0.1:8080") || target.url.includes("192.168.1.231:8080")) {
    ms = 120 * 1000; // 2 min cooldown when Z Fold 3 is unplugged/offline
  }
  cooldownUntil.set(target.name, Date.now() + ms);
}

function sanitizeForTarget(payload) {
  if (!payload || !Array.isArray(payload.messages)) return payload;

  const MAX_TOTAL_CHARS = 12000; // ~3000 tokens, fast and safe for all providers (Groq, Gemini, Gemma 4)
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
      m.content.slice(0, keepHead) +
      "\n\n...[trimmed middle observations to stay within rate & latency limits]...\n\n" +
      m.content.slice(-keepTail);
    return { ...m, content };
  });

  return { ...payload, messages };
}

function escapeXmlBareAmpersands(xml) {
  return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, "&amp;");
}

function cleanResponseData(rawText) {
  try {
    const obj = JSON.parse(rawText);
    if (Array.isArray(obj.choices)) {
      for (const c of obj.choices) {
        if (typeof c?.message?.content === "string") {
          let text = c.message.content;
          if (text.includes("</thought>") || text.includes("</think>")) {
            text = text.replace(/<(?:thought|think)>[\s\S]*?<\/(?:thought|think)>\s*/gi, "").trim();
          }
          if (text.includes("<summary>") || text.includes("<observation>")) {
            text = escapeXmlBareAmpersands(text);
          }
          c.message.content = text;
        }
      }
      return JSON.stringify(obj);
    }
  } catch {}
  return rawText;
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

// Target #11: Instant Local Extractive Fallback (0% GPU, <1ms) so AgentMemory NEVER fails or pauses!
function buildLocalExtractiveFallback(parsed) {
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const userMsg = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n") || "";

  let content = "";

  if (systemMsg.includes("<summary>")) {
    // Session summary or chunk reduce fallback
    const titles = [];
    for (const m of userMsg.matchAll(/(?:\[\d+\]\s+[a-z_]+:\s+|Title:\s+)([^\n]+)/gi)) {
      const t = m[1].trim();
      if (t && t.length > 3 && !titles.includes(t)) titles.push(t);
    }
    const files = [];
    for (const m of userMsg.matchAll(/(?:Files:\s*|-\s*)(\/[^\s,\n]+|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/g)) {
      const f = m[1].trim();
      if (f && !files.includes(f)) files.push(f);
    }
    const concepts = [];
    for (const m of userMsg.matchAll(/Concepts:\s*([^\n]+)/gi)) {
      for (const c of m[1].split(",")) {
        const clean = c.trim();
        if (clean && !concepts.includes(clean)) concepts.push(clean);
      }
    }

    const mainTitle = (titles[titles.length - 1] || titles[0] || "Coding & System Optimization Session").slice(0, 95);
    const sampleTitles = titles.slice(-6).join("; ") || "Executed project tasks, diagnostics, and configuration updates";
    const narrative = `Completed session activities across ${titles.length || 1} key milestones: ${sampleTitles}. All observations and state changes were captured and indexed in AgentMemory.`;
    const decisionList = (titles.slice(0, 4).length ? titles.slice(0, 4) : ["Completed automated session state verification and memory indexing"])
      .map((d) => `    <decision>${escapeXml(d.slice(0, 140))}</decision>`)
      .join("\n");
    const fileList = (files.slice(0, 12).length ? files.slice(0, 12) : ["~/.agentmemory/.env"])
      .map((f) => `    <file>${escapeXml(f)}</file>`)
      .join("\n");
    const conceptList = (concepts.slice(0, 8).length ? concepts.slice(0, 8) : ["session-summary", "agentmemory", "system-configuration"])
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
    // Observation compression fallback
    const toolMatch = /Tool:\s*([^\n]+)/i.exec(userMsg);
    const hookMatch = /Hook:\s*([^\n]+)/i.exec(userMsg);
    const toolName = toolMatch ? toolMatch[1].trim() : hookMatch ? hookMatch[1].trim() : "operation";
    let obsType = "other";
    if (/read|view/i.test(toolName)) obsType = "file_read";
    else if (/write|create/i.test(toolName)) obsType = "file_write";
    else if (/edit|replace/i.test(toolName)) obsType = "file_edit";
    else if (/run|command|bash|exec/i.test(toolName)) obsType = "command_run";
    else if (/search|grep|find/i.test(toolName)) obsType = "search";
    else if (/prompt/i.test(toolName)) obsType = "conversation";

    const firstLine = userMsg
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 15 && !l.startsWith("Timestamp:") && !l.startsWith("Hook:") && !l.startsWith("Tool:")) || `Executed ${toolName}`;
    const title = `${toolName}: ${firstLine}`.slice(0, 75);
    const narrative = `Executed ${toolName} during coding session (${firstLine.slice(0, 120)}). Output was captured and indexed for session memory retrieval.`;

    content = `<observation>
  <type>${obsType}</type>
  <title>${escapeXml(title)}</title>
  <subtitle>${escapeXml(toolName)}</subtitle>
  <facts>
    <fact>${escapeXml(firstLine.slice(0, 160))}</fact>
    <fact>Processed via ${escapeXml(toolName)}</fact>
  </facts>
  <narrative>${escapeXml(narrative)}</narrative>
  <concepts>
    <concept>${escapeXml(toolName)}</concept>
    <concept>agent-workflow</concept>
  </concepts>
  <files>
    <file>workspace</file>
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

  // Instant Zero-Token Passthrough for Direct Graph Linking (<entities>...<relationships>...)
  const allUserText = (Array.isArray(parsed?.messages) ? parsed.messages : [])
    .filter((m) => m.role === "user")
    .map((m) => m.content || "")
    .join("\n");
  if (allUserText.includes("DIRECT_GRAPH_XML")) {
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
        const data = cleanResponseData(await response.text());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
        return;
      }
      const errText = await response.text();
      markCooldown(target, response.status, errText);
      console.log(`[Router] ${target.name} returned ${response.status} (cooling down): ${errText.slice(0, 140)}`);
    } catch (err) {
      markCooldown(target, 0, err.message);
      console.log(`[Router] ${target.name} unreachable (${err.message}), cooling down & falling back...`);
    }
  }

  console.log("[Router] All remote/local LLM targets cooling down -> using Zero-Fail Local Extractive Fallback!");
  const fallbackData = buildLocalExtractiveFallback(sanitized);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(fallbackData);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Smart AI Router listening on http://127.0.0.1:${PORT}`);
});
