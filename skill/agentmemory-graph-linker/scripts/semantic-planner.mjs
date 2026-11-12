/**
 * AgentMemory Semantic Planner (v4.0 — Gemini 4 Hydrogen Neuro-Symbolic Extension)
 *
 * Zero-side-effect module providing:
 * 1. scoreSynonymPair(nodeA, nodeB, neighborsById)
 * 2. findSemanticDuplicateCandidates(deps, options)
 * 3. applySemanticMergePlan(deps, planItems, options)
 * 4. buildSemanticLinkBatch(deps, options)
 * 5. applyTemporalLinks(deps, triples, options)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const HOME = os.homedir();
const DEFAULT_AGENTMEMORY_DIR =
  process.env.AGENTMEMORY_DATA_DIR || path.join(HOME, ".agentmemory");
const DEFAULT_GRAVEYARD_PATH = path.join(DEFAULT_AGENTMEMORY_DIR, "graveyard.jsonl");
const DEFAULT_BASE_URL = process.env.AGENTMEMORY_URL || "http://localhost:3111";
const DEFAULT_III_NAMESPACE = process.env.AGENTMEMORY_NAMESPACE || "agentmemory-3111";

export const MAX_NODE_ALIASES = 10;
export const MAX_NODE_SOURCE_OBS = 24;

export const SEMANTIC_RELATIONS = new Set([
  "uses",
  "imports",
  "modifies",
  "causes",
  "fixes",
  "depends_on",
  "related_to",
  "implements",
  "configures",
  "replaces",
  "caused_by",
  "optimizes",
  "optimizes_for",
  "works_at",
  "prefers",
  "blocked_by",
  "rejected",
  "avoids",
  "located_in",
  "succeeded_by",
  "supersedes"
]);

const BASE_DIRECT_XML_RELATIONS = new Set([
  "uses",
  "imports",
  "modifies",
  "causes",
  "fixes",
  "depends_on",
  "related_to"
]);

const UNICODE_ALL_DASHES_REGEX = /[\u2010-\u2015\u2212\u00ad]/g;
const ZERO_WIDTH_REGEX = /[\u200b-\u200d\ufeff]/g;
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;
const HALLUCINATION_REGEX =
  /\b(invasion\s+german|german\s+invasion|third\s+reich|adolf\s+hitler|nazi\s+party|world\s+war\s+ii|holocaust|soviet\s+invasion|roman\s+empire|medieval\s+europe|napoleonic)\b/i;

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

const IMMUNE_NODE_TYPES = new Set([
  "decision",
  "preference",
  "pattern",
  "person",
  "project",
  "milestone",
  "song"
]);

const STOPWORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with"]);

const THEMATIC_DOMAINS = [
  {
    id: "ai_models",
    label: "AI Models & Smart Router",
    anchor: { name: "Smart AI Router", type: "pattern" },
    subAnchor: { name: "OpenAI chat completions API", type: "concept" },
    keywords: [
      "groq", "gemini", "gemma", "qwen", "openai", "token", "prompt", "completion",
      "router", "embedding", "tpm", "tpd", "rate limit", "llm", "ai", "model", "gpt",
      "toshllm", "ocr", "glm", "llama", "gguf", "vision", "hydrogen"
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
    label: "macOS Hardware & Hi-Res Audio",
    anchor: { name: "MacBook Pro", type: "concept" },
    subAnchor: { name: "CoreAudio HAL", type: "concept" },
    keywords: [
      "audio", "coreaudio", "hal", "ark", "driver", "amcp", "plug-in", "volume",
      "applescript", "macbook", "dgpu", "thermal", "kernel", "fedora", "coreaudiod", "xcode", "egpu",
      "music", "song", "track", "album", "artist", "flac", "alac", "hi-res", "lossless", "bit-perfect",
      "midi", "hz", "sample rate", "khz", "dac", "dsp", "speaker", "headphone", "iina", "pine player",
      "sangeet", "michael jackson", "hollywood tonight", "daft punk"
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

function truncateSafe(str, maxChars = 240) {
  const clean = stripLoneSurrogates(String(str ?? "")).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const chars = Array.from(clean);
  if (chars.length <= maxChars) return clean;
  return `${chars.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

function generateId(prefix) {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function normalizeSemanticText(name) {
  return unescapeXml(name)
    .normalize("NFKC")
    .replace(UNICODE_ALL_DASHES_REGEX, "-")
    .replace(ZERO_WIDTH_REGEX, "")
    .replace(/\s+/g, " ")
    .replace(/\\+$/g, "")
    .trim();
}

export function normalizeSemanticKey(name) {
  return normalizeSemanticText(name).toLowerCase();
}

function isTransientScratchNode(node) {
  const nm = normalizeSemanticText(node?.name || "");
  if (!nm) return true;
  return (
    nm.includes("/.system_generated/") ||
    nm.includes("/.user_uploaded/") ||
    /^media_\d+_[0-9a-f]+\.[a-z0-9]+$/i.test(nm) ||
    /^task-\d+\.log$/i.test(nm) ||
    /^steps\/\d+\/output\.txt$/i.test(nm) ||
    /^obs_[a-z0-9_]+$/i.test(nm) ||
    /^cap_[a-z0-9_]+$/i.test(nm) ||
    nm.startsWith("/tmp/") ||
    nm.startsWith("/private/tmp/") ||
    nm.includes("/var/folders/") ||
    nm === "workspace"
  );
}

function getErrorFingerprintKey(node) {
  if (!node || node.type !== "error") return null;
  const clean = normalizeSemanticText(node.name || "");
  if (
    /xcodebuild/i.test(clean) &&
    (/unable to find utility/i.test(clean) ||
      /not found/i.test(clean) ||
      /exit code 72/i.test(clean) ||
      /xcodebuild_not_found/i.test(clean))
  ) {
    return "error_fp:xcodebuild_not_found";
  }
  const norm = clean
    .toLowerCase()
    .replace(/['"`“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `error_fp:${norm}`;
}

function getExactDedupGroupKey(node) {
  const raw = unescapeXml(node?.name || "").replace(/\\+$/g, "").trim();
  const unescaped = normalizeSemanticText(raw);
  const normKey = unescaped.toLowerCase();
  if (!unescaped) return "";
  if (node.type === "error") return getErrorFingerprintKey(node);
  if (node.type === "person" && /^(quỳnh|quynh|quyên|quyén)$/i.test(unescaped)) {
    return "person|quỳnh";
  }
  if (CJK_CANONICAL_MAP.has(unescaped) || CJK_CANONICAL_MAP.has(raw)) {
    const canonical = CJK_CANONICAL_MAP.get(unescaped) || CJK_CANONICAL_MAP.get(raw);
    return `${node.type}|${normalizeSemanticKey(canonical)}`;
  }
  if (
    node.type === "song" ||
    node.properties?.artist ||
    node.properties?.category === "song title" ||
    normKey === "hollywood tonight"
  ) {
    return `song|${normKey}`;
  }
  return `${node.type}|${normKey}`;
}

function isPathLike(node, normName) {
  return (
    node?.type === "file" ||
    normName.startsWith("/") ||
    normName.startsWith("~/") ||
    (normName.match(/\//g)?.length ?? 0) >= 2
  );
}

function stripHomePrefix(normName) {
  return normName
    .replace(/^\/Users\/[^/]+\//i, "")
    .replace(/^\/home\/[^/]+\//i, "")
    .replace(/^~\//, "");
}

function extractFileStem(normName) {
  const segments = normName.split("/").filter(Boolean);
  const base = segments.length ? segments[segments.length - 1] : normName;
  return base.replace(/\.[a-z0-9]{1,8}$/i, "");
}

function splitTokens(text, splitCamel = true) {
  const prepared = splitCamel
    ? text
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    : text;
  return prepared
    .toLowerCase()
    .split(/[^a-z0-9à-ỹ]+/i)
    .filter(Boolean);
}

export function tokenizeSemanticName(name, nodeType = "") {
  const norm = normalizeSemanticText(name);
  if (!norm) return [];
  const base =
    nodeType === "file" || norm.startsWith("/") || norm.startsWith("~/")
      ? stripHomePrefix(norm)
      : norm;
  return splitTokens(base, true);
}

function setJaccard(setA, setB) {
  if (!setA.size && !setB.size) return { score: 0, intersection: [] };
  const intersection = [];
  for (const item of setA) {
    if (setB.has(item)) intersection.push(item);
  }
  const unionSize = setA.size + setB.size - intersection.length;
  return {
    score: unionSize > 0 ? intersection.length / unionSize : 0,
    intersection
  };
}

function isOrderedSubsequence(shortStr, longStr) {
  let i = 0;
  for (let j = 0; j < longStr.length && i < shortStr.length; j++) {
    if (shortStr[i] === longStr[j]) i++;
  }
  return i === shortStr.length;
}

function computeAcronymAndAbbrev(tokensA, tokensB, compactA, compactB) {
  let score = 0;

  const checkAcronym = (shortCompact, phraseTokens, rawPhraseTokens) => {
    if (shortCompact.length < 2 || shortCompact.length > 10) return 0;
    if (!/^[a-z0-9]+$/.test(shortCompact)) return 0;
    if (phraseTokens.length < 2) return 0;
    const allInit = phraseTokens.map((t) => t[0]).join("");
    const nonStopTokens = phraseTokens.filter((t) => !STOPWORDS.has(t));
    const coreInit = nonStopTokens.map((t) => t[0]).join("");
    if (shortCompact === allInit || (coreInit.length >= 2 && shortCompact === coreInit)) {
      const explicitParen = rawPhraseTokens.includes(shortCompact);
      return explicitParen ? 0.92 : 0.85;
    }
    return 0;
  };

  score = Math.max(
    score,
    checkAcronym(compactA, tokensB, tokensB),
    checkAcronym(compactB, tokensA, tokensA)
  );

  // Also check acronym stripping trailing parenthetical acronym on the phrase side
  const nonParenA = tokensA.filter((t) => t !== compactB);
  const nonParenB = tokensB.filter((t) => t !== compactA);
  if (nonParenB.length >= 2) {
    score = Math.max(score, checkAcronym(compactA, nonParenB, tokensB));
  }
  if (nonParenA.length >= 2) {
    score = Math.max(score, checkAcronym(compactB, nonParenA, tokensA));
  }

  // Token-level prefix & consonant-skeleton abbreviation score (e.g. cfg<->config, auth<->authentication)
  if (tokensA.length > 0 && tokensB.length > 0) {
    const usedB = new Set();
    let matchedWeight = 0;
    for (const ta of tokensA) {
      let bestW = 0;
      let bestIdx = -1;
      for (let idx = 0; idx < tokensB.length; idx++) {
        if (usedB.has(idx)) continue;
        const tb = tokensB[idx];
        if (ta === tb) {
          bestW = 1;
          bestIdx = idx;
          break;
        }
        const shorter = ta.length <= tb.length ? ta : tb;
        const longer = ta.length <= tb.length ? tb : ta;
        if (shorter.length >= 3 && longer.startsWith(shorter) && shorter.length / longer.length >= 0.4) {
          if (0.78 > bestW) {
            bestW = 0.78;
            bestIdx = idx;
          }
        } else if (
          shorter.length >= 3 &&
          shorter[0] === longer[0] &&
          shorter.length / longer.length >= 0.38 &&
          isOrderedSubsequence(shorter, longer)
        ) {
          if (0.72 > bestW) {
            bestW = 0.72;
            bestIdx = idx;
          }
        }
      }
      if (bestIdx !== -1 && bestW > 0) {
        usedB.add(bestIdx);
        matchedWeight += bestW;
      }
    }
    const maxLen = Math.max(tokensA.length, tokensB.length);
    const abbrevTokenRatio = maxLen > 0 ? matchedWeight / maxLen : 0;
    if (abbrevTokenRatio >= 0.45) {
      score = Math.max(score, Math.min(0.85, abbrevTokenRatio * 0.9));
    }
  }

  return score;
}

function getNeighborSet(neighborsById, nodeId) {
  if (!neighborsById || !nodeId) return new Set();
  const raw =
    neighborsById instanceof Map ? neighborsById.get(nodeId) : neighborsById[nodeId];
  if (!raw) return new Set();
  return raw instanceof Set ? raw : new Set(Array.isArray(raw) ? raw : []);
}

function prepareNodeLexical(node) {
  const norm = normalizeSemanticText(node?.name || "");
  if (!norm) return null;
  const pathLike = isPathLike(node, norm);
  const base = pathLike ? stripHomePrefix(norm) : norm;
  const camelTokens = splitTokens(base, true);
  const rawTokens = splitTokens(base, false);
  const camelSet = new Set(camelTokens);
  const rawSet = new Set(rawTokens);
  const compact = base.toLowerCase().replace(/[^a-z0-9à-ỹ]+/g, "");
  const obsSet = new Set(
    Array.isArray(node?.sourceObservationIds) ? node.sourceObservationIds : []
  );

  let stem = "";
  let stemTokens = [];
  let stemSet = null;
  let stemCompact = "";
  if (pathLike) {
    stem = extractFileStem(norm);
    if (stem) {
      stemTokens = splitTokens(stem, true);
      stemSet = new Set(stemTokens);
      stemCompact = stem.toLowerCase().replace(/[^a-z0-9à-ỹ]+/g, "");
    }
  }

  return {
    id: node?.id,
    type: node?.type,
    norm,
    pathLike,
    base,
    camelTokens,
    rawTokens,
    camelSet,
    rawSet,
    compact,
    obsSet,
    stem,
    stemTokens,
    stemSet,
    stemCompact
  };
}

function hasDisjointFileBasenames(prepA, prepB) {
  if (!prepA.pathLike || !prepB.pathLike) return false;
  if (!prepA.stem || !prepB.stem) return false;
  if (prepA.stem.toLowerCase() === prepB.stem.toLowerCase()) return false;
  const stemOverlap = setJaccard(prepA.stemSet, prepB.stemSet).intersection.length;
  if (stemOverlap > 0) return false;
  const minLen = Math.min(prepA.stemCompact.length, prepB.stemCompact.length);
  if (
    minLen >= 3 &&
    (prepA.stemCompact.includes(prepB.stemCompact) ||
      prepB.stemCompact.includes(prepA.stemCompact))
  ) {
    return false;
  }
  const stemAbbrev = computeAcronymAndAbbrev(
    prepA.stemTokens,
    prepB.stemTokens,
    prepA.stemCompact,
    prepB.stemCompact
  );
  return stemAbbrev < 0.5;
}

function scorePreparedPair(prepA, prepB, neighborsById = new Map()) {
  if (!prepA || !prepB) {
    return { score: 0, reasons: [], sharedNeighbors: [], sharedObs: [] };
  }

  const compactExact = Boolean(prepA.compact && prepA.compact === prepB.compact);
  const camelJac = setJaccard(prepA.camelSet, prepB.camelSet).score;
  const rawJac = setJaccard(prepA.rawSet, prepB.rawSet).score;
  const tokenJaccard = Math.max(camelJac, rawJac);
  const effectiveTokenSim = compactExact ? Math.max(tokenJaccard, 0.95) : tokenJaccard;

  const abbrevScore = computeAcronymAndAbbrev(
    prepA.camelTokens,
    prepB.camelTokens,
    prepA.compact,
    prepB.compact
  );

  let containmentScore = 0;
  if (prepA.camelSet.size > 0 && prepB.camelSet.size > 0) {
    const smaller = prepA.camelSet.size <= prepB.camelSet.size ? prepA.camelSet : prepB.camelSet;
    const larger = prepA.camelSet.size <= prepB.camelSet.size ? prepB.camelSet : prepA.camelSet;
    const inter = setJaccard(smaller, larger).intersection.length;
    const tokenContainment = inter / smaller.size;
    const minCompLen = Math.min(prepA.compact.length, prepB.compact.length);
    const maxCompLen = Math.max(prepA.compact.length, prepB.compact.length);
    const lenRatio = maxCompLen > 0 ? minCompLen / maxCompLen : 0;

    if (
      minCompLen >= 4 &&
      (prepA.compact.includes(prepB.compact) || prepB.compact.includes(prepA.compact))
    ) {
      containmentScore = Math.max(containmentScore, 0.58 + 0.37 * lenRatio);
    }
    if (tokenContainment === 1) {
      containmentScore = Math.max(containmentScore, 0.52 + 0.42 * lenRatio);
    } else if (tokenContainment > 0) {
      containmentScore = Math.max(
        containmentScore,
        tokenContainment * (0.45 + 0.35 * lenRatio)
      );
    }
  }

  const matchSim = Math.max(abbrevScore, containmentScore);
  let lexicalScore =
    0.65 * Math.max(effectiveTokenSim, matchSim) +
    0.35 * Math.min(effectiveTokenSim, matchSim);

  const disjointFileBasenames = hasDisjointFileBasenames(prepA, prepB);
  if (disjointFileBasenames) {
    lexicalScore = Math.min(lexicalScore, 0.15);
  }

  // Shared neighbors (excluding nodeA.id and nodeB.id themselves)
  const rawNeighA = getNeighborSet(neighborsById, prepA.id);
  const rawNeighB = getNeighborSet(neighborsById, prepB.id);
  const sharedNeighbors = [];
  let unionNeighCount = rawNeighA.size + rawNeighB.size;
  if (prepA.id && rawNeighB.has(prepA.id)) unionNeighCount -= 1;
  if (prepB.id && rawNeighA.has(prepB.id)) unionNeighCount -= 1;
  let sizeA = rawNeighA.size - (prepB.id && rawNeighA.has(prepB.id) ? 1 : 0);
  let sizeB = rawNeighB.size - (prepA.id && rawNeighB.has(prepA.id) ? 1 : 0);
  for (const nid of rawNeighA) {
    if (nid !== prepA.id && nid !== prepB.id && rawNeighB.has(nid)) {
      sharedNeighbors.push(nid);
    }
  }
  const actualNeighUnion = sizeA + sizeB - sharedNeighbors.length;
  const neighborJaccard = actualNeighUnion > 0 ? sharedNeighbors.length / actualNeighUnion : 0;

  // Shared sourceObservationIds
  const obsRes = setJaccard(prepA.obsSet, prepB.obsSet);
  const sharedObs = obsRes.intersection;
  const obsJaccard = obsRes.score;

  const hasNeighbors = sizeA > 0 || sizeB > 0;
  const hasObs = prepA.obsSet.size > 0 || prepB.obsSet.size > 0;
  const wLex = 0.6;
  const wNeigh = hasNeighbors ? 0.25 : 0;
  const wObs = hasObs ? 0.15 : 0;
  const weightSum = wLex + wNeigh + wObs;

  let score =
    (wLex * lexicalScore + wNeigh * neighborJaccard + wObs * obsJaccard) / weightSum;
  if (disjointFileBasenames) {
    score = Math.min(score, 0.35);
  }
  score = Math.max(0, Math.min(1, Number(score.toFixed(4))));

  const reasons = [];
  if (compactExact) reasons.push("compact_match");
  if (tokenJaccard > 0) reasons.push(`token_jaccard:${tokenJaccard.toFixed(2)}`);
  if (abbrevScore >= 0.5) reasons.push("abbreviation_match");
  if (containmentScore >= 0.45 && !compactExact) reasons.push("containment_match");
  if (sharedNeighbors.length > 0) reasons.push(`shared_neighbors:${sharedNeighbors.length}`);
  if (sharedObs.length > 0) reasons.push(`shared_obs:${sharedObs.length}`);
  if (disjointFileBasenames) reasons.push("disjoint_file_basenames_capped");

  return {
    score,
    reasons,
    sharedNeighbors,
    sharedObs
  };
}

/**
 * Pure helper computing structural + lexical similarity between two graph nodes.
 * Handles NFKC + Unicode hyphen normalization, token Jaccard, containment/abbreviation match,
 * shared neighbor Jaccard, and shared sourceObservationIds Jaccard.
 */
export function scoreSynonymPair(nodeA, nodeB, neighborsById = new Map()) {
  const prepA = prepareNodeLexical(nodeA);
  const prepB = prepareNodeLexical(nodeB);
  return scorePreparedPair(prepA, prepB, neighborsById);
}

function chooseWinnerAndAliases(nodeA, nodeB, degreeMap) {
  const scoreNode = (n) => {
    const rawName = String(n?.name || "");
    const deg = degreeMap.get(n.id) || 0;
    const hasXml = /&(?:quot|lt|gt|amp|apos|#\d+|#x[\da-f]+);/i.test(rawName);
    const hasUnicodeDash = /[\u2010-\u2015\u2212\u00ad\u200b-\u200d\ufeff]/.test(rawName);
    const isImmune = IMMUNE_NODE_TYPES.has(n.type);
    const obsLen = Array.isArray(n.sourceObservationIds) ? n.sourceObservationIds.length : 0;
    const occ = Number(n.properties?.occurrences) || 1;
    const cleanLen = normalizeSemanticText(rawName).length;
    return (
      (hasXml ? -500 : 200) +
      (hasUnicodeDash ? -150 : 100) +
      (isImmune ? 120 : 0) +
      deg * 8 +
      occ * 4 +
      obsLen * 2 +
      Math.min(cleanLen, 60) * 0.25
    );
  };

  const sA = scoreNode(nodeA);
  const sB = scoreNode(nodeB);
  const aWins = sA > sB || (sA === sB && String(nodeA.id) <= String(nodeB.id));
  const winner = aWins ? nodeA : nodeB;
  const loser = aWins ? nodeB : nodeA;
  const canonicalName = normalizeSemanticText(winner.name);
  const canonicalKey = canonicalName.toLowerCase();

  const seenAliasKeys = new Set([canonicalKey]);
  const aliases = [];
  for (const raw of [
    ...(Array.isArray(winner.aliases) ? winner.aliases : []),
    loser.name,
    ...(Array.isArray(loser.aliases) ? loser.aliases : [])
  ]) {
    const clean = normalizeSemanticText(raw);
    const key = clean.toLowerCase();
    if (!clean || seenAliasKeys.has(key)) continue;
    seenAliasKeys.add(key);
    aliases.push(clean);
  }

  return {
    suggestedWinner: {
      id: winner.id,
      type: winner.type,
      name: winner.name,
      canonicalName,
      degree: degreeMap.get(winner.id) || 0
    },
    suggestedAliases: aliases.slice(-MAX_NODE_ALIASES)
  };
}

function summarizeCandidateNode(node, degreeMap) {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    aliases: Array.isArray(node.aliases) ? node.aliases.slice(0, MAX_NODE_ALIASES) : [],
    degree: degreeMap.get(node.id) || 0,
    sourceObservationIds: Array.isArray(node.sourceObservationIds)
      ? node.sourceObservationIds.slice(0, MAX_NODE_SOURCE_OBS)
      : []
  };
}

/**
 * Scans mem:graph:nodes & mem:graph:edges via deps.engine, skips exact duplicates,
 * and returns top non-exact synonym/alias candidate pairs for Gemini 4 Hydrogen review.
 */
export async function findSemanticDuplicateCandidates(deps, options = {}) {
  const engine = deps?.engine;
  if (!engine) throw new Error("findSemanticDuplicateCandidates requires deps.engine");

  const limit = Math.max(1, Number(options.limit ?? 50));
  const minScore = Number(options.minScore ?? 0.45);
  const includeCrossType = options.includeCrossType !== false;

  const [nodesRaw, edgesRaw] = await Promise.all([
    engine.kvList("mem:graph:nodes"),
    engine.kvList("mem:graph:edges")
  ]);

  const liveNodes = (nodesRaw || []).filter(
    (n) => n && n.id && n.name && !n.stale && !isTransientScratchNode(n)
  );
  const liveEdges = (edgesRaw || []).filter(
    (e) => e && e.id && !e.stale && e.isLatest !== false
  );

  const neighborsById = new Map();
  const degreeMap = new Map();
  for (const e of liveEdges) {
    if (!neighborsById.has(e.sourceNodeId)) neighborsById.set(e.sourceNodeId, new Set());
    if (!neighborsById.has(e.targetNodeId)) neighborsById.set(e.targetNodeId, new Set());
    neighborsById.get(e.sourceNodeId).add(e.targetNodeId);
    neighborsById.get(e.targetNodeId).add(e.sourceNodeId);
    degreeMap.set(e.sourceNodeId, (degreeMap.get(e.sourceNodeId) || 0) + 1);
    degreeMap.set(e.targetNodeId, (degreeMap.get(e.targetNodeId) || 0) + 1);
  }

  // Inverted blocking index for O(N) candidate pair generation across 6k+ nodes
  const buckets = new Map();
  const addBucket = (key, idx) => {
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(idx);
  };

  const nodeCount = liveNodes.length;
  const exactKeys = new Array(nodeCount);
  const prepared = new Array(nodeCount);

  for (let i = 0; i < nodeCount; i++) {
    const node = liveNodes[i];
    exactKeys[i] = getExactDedupGroupKey(node);
    const prep = prepareNodeLexical(node);
    prepared[i] = prep;
    if (!prep) continue;

    if (prep.compact) addBucket(`cmp:${prep.compact}`, i);
    if (prep.compact.length >= 4 && !/^\d+$/.test(prep.compact.slice(0, 4))) {
      addBucket(`sub4:${prep.compact.slice(0, 4)}`, i);
    }

    for (const tok of prep.camelSet) {
      if (tok.length >= 2) addBucket(`tok:${tok}`, i);
      if (tok.length >= 3 && !/^\d+$/.test(tok)) addBucket(`pre3:${tok.slice(0, 3)}`, i);
    }

    if (prep.camelTokens.length >= 2 && prep.camelTokens.length <= 10) {
      const initAll = prep.camelTokens.map((t) => t[0]).join("");
      const initCore = prep.camelTokens
        .filter((t) => !STOPWORDS.has(t))
        .map((t) => t[0])
        .join("");
      if (initAll.length >= 2) addBucket(`acr:${initAll}`, i);
      if (initCore.length >= 2 && initCore !== initAll) addBucket(`acr:${initCore}`, i);
    } else if (
      prep.compact.length >= 2 &&
      prep.compact.length <= 10 &&
      /^[a-z0-9]+$/.test(prep.compact)
    ) {
      addBucket(`acr:${prep.compact}`, i);
    }

    if (minScore < 0.42) {
      for (const nId of neighborsById.get(node.id) || []) addBucket(`nbr:${nId}`, i);
      for (const obsId of node.sourceObservationIds || []) addBucket(`obs:${obsId}`, i);
    }
  }

  const MAX_TOKEN_BUCKET = 120;
  const MAX_PREFIX_BUCKET = 80;
  const MAX_EXACT_BUCKET = 250;
  const seenPairs = new Set();
  const candidates = [];

  for (const [bKey, idxs] of buckets.entries()) {
    if (idxs.length < 2) continue;
    const isPrefix = bKey.startsWith("pre3:") || bKey.startsWith("sub4:");
    const isExact = bKey.startsWith("cmp:") || bKey.startsWith("acr:");
    const cap = isPrefix ? MAX_PREFIX_BUCKET : isExact ? MAX_EXACT_BUCKET : MAX_TOKEN_BUCKET;
    if (idxs.length > cap) continue;

    for (let aPos = 0; aPos < idxs.length; aPos++) {
      const i = idxs[aPos];
      for (let bPos = aPos + 1; bPos < idxs.length; bPos++) {
        const j = idxs[bPos];
        const lo = i < j ? i : j;
        const hi = i < j ? j : i;
        const pairKey = lo * nodeCount + hi;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const nodeA = liveNodes[lo];
        const nodeB = liveNodes[hi];
        if (!includeCrossType && nodeA.type !== nodeB.type) continue;
        if (exactKeys[lo] && exactKeys[lo] === exactKeys[hi]) continue;

        const prepA = prepared[lo];
        const prepB = prepared[hi];
        if (!prepA || !prepB) continue;
        if (minScore > 0.35 && hasDisjointFileBasenames(prepA, prepB)) continue;

        const sim = scorePreparedPair(prepA, prepB, neighborsById);
        if (sim.score < minScore) continue;

        const { suggestedWinner, suggestedAliases } = chooseWinnerAndAliases(
          nodeA,
          nodeB,
          degreeMap
        );
        const reasons =
          nodeA.type === nodeB.type
            ? [...sim.reasons, "same_type"]
            : [...sim.reasons, "cross_type"];

        candidates.push({
          nodeA: summarizeCandidateNode(nodeA, degreeMap),
          nodeB: summarizeCandidateNode(nodeB, degreeMap),
          score: sim.score,
          reasons,
          sharedNeighbors: sim.sharedNeighbors,
          sharedObs: sim.sharedObs,
          suggestedWinner,
          suggestedAliases
        });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.nodeA.degree + b.nodeB.degree - (a.nodeA.degree + a.nodeB.degree) ||
      String(a.nodeA.id).localeCompare(String(b.nodeA.id)) ||
      String(a.nodeB.id).localeCompare(String(b.nodeB.id))
  );

  const selected = candidates.slice(0, limit);
  return {
    status: "candidates_ready",
    version: "4.0",
    totalNodesScanned: liveNodes.length,
    totalEdgesScanned: liveEdges.length,
    minScore,
    limit,
    candidateCount: selected.length,
    candidates: selected
  };
}

function appendToGraveyard(entries, graveyardPath) {
  if (!entries || !entries.length) return 0;
  const targetPath = graveyardPath || DEFAULT_GRAVEYARD_PATH;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.appendFileSync(targetPath, lines, "utf8");
  return entries.length;
}

function resolveNodeRef(ref, nodeById, allNodes, mergedIntoMap = null, preferredType = null) {
  if (ref === null || ref === undefined) return null;
  const query = typeof ref === "object" ? ref.id || ref.name : String(ref);
  if (!query) return null;

  const followMerged = (id) => {
    let cur = id;
    if (mergedIntoMap && mergedIntoMap.has(cur)) {
      const guard = new Set();
      while (mergedIntoMap.has(cur) && !guard.has(cur)) {
        guard.add(cur);
        cur = mergedIntoMap.get(cur);
      }
    }
    return nodeById.get(cur) || null;
  };

  const direct = followMerged(query);
  if (direct) return direct;

  const pickBest = (matches) => {
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    if (preferredType) {
      const typed = matches.find((m) => m.type === preferredType);
      if (typed) return typed;
    }
    return matches[0];
  };

  // Search live mutated nodes first (captures canonicalName renames from prior steps),
  // then fall back to pre-plan entries redirected through mergedIntoMap.
  const liveNodes = Array.from(nodeById.values());
  const redirectFallback = (predicate) => {
    if (!mergedIntoMap || !mergedIntoMap.size || !Array.isArray(allNodes)) return [];
    const seen = new Set();
    const out = [];
    for (const n of allNodes) {
      if (!n || !predicate(n)) continue;
      const target = followMerged(n.id);
      if (target && !seen.has(target.id)) {
        seen.add(target.id);
        out.push(target);
      }
    }
    return out;
  };

  const exactMatches = liveNodes.filter((n) => n && n.name === query);
  if (exactMatches.length) return pickBest(exactMatches);
  if (mergedIntoMap) {
    const redirectedExact = redirectFallback((n) => n.name === query);
    if (redirectedExact.length) return pickBest(redirectedExact);
  }

  const normQuery = normalizeSemanticText(query);
  const normMatches = liveNodes.filter((n) => n && normalizeSemanticText(n.name) === normQuery);
  if (normMatches.length) return pickBest(normMatches);
  if (mergedIntoMap) {
    const redirectedNorm = redirectFallback((n) => normalizeSemanticText(n.name) === normQuery);
    if (redirectedNorm.length) return pickBest(redirectedNorm);
  }

  const lowerQuery = normQuery.toLowerCase();
  const ciMatches = liveNodes.filter((n) => n && normalizeSemanticKey(n.name) === lowerQuery);
  if (ciMatches.length === 1) return ciMatches[0];
  if (ciMatches.length > 1 && preferredType) {
    return ciMatches.find((m) => m.type === preferredType) || null;
  }
  if (mergedIntoMap && ciMatches.length === 0) {
    const redirectedCi = redirectFallback((n) => normalizeSemanticKey(n.name) === lowerQuery);
    if (redirectedCi.length === 1) return redirectedCi[0];
    if (redirectedCi.length > 1 && preferredType) {
      return redirectedCi.find((m) => m.type === preferredType) || null;
    }
    const aliasMatches = liveNodes.filter(
      (n) =>
        Array.isArray(n?.aliases) &&
        n.aliases.some((a) => normalizeSemanticKey(String(a)) === lowerQuery)
    );
    if (aliasMatches.length === 1) return aliasMatches[0];
    if (aliasMatches.length > 1 && preferredType) {
      return aliasMatches.find((m) => m.type === preferredType) || null;
    }
  }

  return null;
}

async function triggerSnapshotRebuild(deps) {
  const engine = deps?.engine;
  if (typeof engine?.worker?.trigger === "function") {
    try {
      await engine.worker.trigger({
        namespace: deps?.namespace || DEFAULT_III_NAMESPACE,
        function_id: "mem::graph-snapshot-rebuild",
        payload: { force: true }
      });
      return true;
    } catch {}
  }
  if (typeof deps?.rebuildSnapshot === "function" && deps?.secret) {
    try {
      await deps.rebuildSnapshot(deps.secret);
      return true;
    } catch {}
  }
  return false;
}

function buildMergedKeepMetadata(keepNode, mergeNode, canonicalNameOverride) {
  const finalName = canonicalNameOverride
    ? normalizeSemanticText(canonicalNameOverride)
    : keepNode.name;

  const finalKey = normalizeSemanticKey(finalName);
  const seenAliases = new Set([finalKey]);
  const mergedAliases = [];

  const addAlias = (val) => {
    const clean = normalizeSemanticText(val);
    const key = clean.toLowerCase();
    if (!clean || seenAliases.has(key)) return;
    seenAliases.add(key);
    mergedAliases.push(clean);
  };

  for (const a of Array.isArray(keepNode.aliases) ? keepNode.aliases : []) addAlias(a);
  if (normalizeSemanticKey(keepNode.name) !== finalKey) addAlias(keepNode.name);
  for (const a of Array.isArray(mergeNode.aliases) ? mergeNode.aliases : []) addAlias(a);
  addAlias(mergeNode.name);

  // Keep latest MAX_NODE_ALIASES (<= 10) so the newly merged name is always preserved
  const boundedAliases = mergedAliases.slice(-MAX_NODE_ALIASES);

  const obsSet = new Set();
  for (const id of keepNode.sourceObservationIds || []) {
    if (typeof id === "string" && id.length > 0) obsSet.add(id);
  }
  for (const id of mergeNode.sourceObservationIds || []) {
    if (typeof id === "string" && id.length > 0) {
      obsSet.delete(id);
      obsSet.add(id);
    }
  }
  const boundedObs = Array.from(obsSet).slice(-MAX_NODE_SOURCE_OBS);

  const occurrences =
    (Number(keepNode.properties?.occurrences) || 1) +
    (Number(mergeNode.properties?.occurrences) || 1);

  return {
    finalName,
    boundedAliases,
    boundedObs,
    occurrences
  };
}

/**
 * Executes an approved merge list ([{ keep, merge, canonicalName?, dryRun? }])
 * safely across all 5 KV layers with alias<=10 & sourceObservationIds<=24 caps,
 * Cold Graveyard archiving (reason: "semantic_merged"), and non-duplicate edge repointing.
 */
export async function applySemanticMergePlan(deps, planItems, options = {}) {
  const engine = deps?.engine;
  if (!engine) throw new Error("applySemanticMergePlan requires deps.engine");

  const rawList = Array.isArray(planItems)
    ? planItems
    : Array.isArray(planItems?.plan)
    ? planItems.plan
    : Array.isArray(planItems?.merges)
    ? planItems.merges
    : [];

  // Flatten items where `merge` is an array of IDs/names
  const normalizedItems = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const merges = Array.isArray(item.merge) ? item.merge : [item.merge];
    for (const m of merges) {
      normalizedItems.push({
        keep: item.keep,
        merge: m,
        canonicalName: item.canonicalName,
        dryRun: item.dryRun
      });
    }
  }

  const globalDryRun = Boolean(options.dryRun);
  const graveyardPath = options.graveyardPath || deps.graveyardPath || DEFAULT_GRAVEYARD_PATH;

  if (normalizedItems.length === 0) {
    return {
      status: globalDryRun ? "dry_run" : "nothing_to_merge",
      version: "4.0",
      dryRun: globalDryRun,
      requestedCount: 0,
      mergedCount: 0,
      skippedCount: 0,
      repointedEdgesCount: 0,
      deletedRedundantEdgesCount: 0,
      graveyardEntriesWritten: 0,
      graveyardFile: graveyardPath,
      results: [],
      totalStoreNodes: null,
      totalStoreEdges: null
    };
  }

  const [allNodesRaw, allEdgesRaw, allFacetsRaw, initialControl] = await Promise.all([
    engine.kvList("mem:graph:nodes"),
    engine.kvList("mem:graph:edges"),
    engine.kvList("mem:facets").catch(() => []),
    engine.kvGet("mem:graph:retrieval-control", "current").catch(() => null)
  ]);

  const allNodes = (allNodesRaw || []).filter((n) => n && n.id && !n.stale);
  const allEdges = (allEdgesRaw || []).filter((e) => e && e.id && !e.stale);
  const allFacets = (allFacetsRaw || []).filter((f) => f && f.id);

  let control = initialControl;
  const nodeById = new Map(allNodes.map((n) => [n.id, structuredClone(n)]));
  const edgeById = new Map(allEdges.map((e) => [e.id, structuredClone(e)]));
  const edgesByNodeId = new Map();
  for (const e of edgeById.values()) {
    if (!edgesByNodeId.has(e.sourceNodeId)) edgesByNodeId.set(e.sourceNodeId, new Set());
    if (!edgesByNodeId.has(e.targetNodeId)) edgesByNodeId.set(e.targetNodeId, new Set());
    edgesByNodeId.get(e.sourceNodeId).add(e.id);
    edgesByNodeId.get(e.targetNodeId).add(e.id);
  }

  const mergedIntoMap = new Map();
  const affectedDegreeNodeIds = new Set();
  const graveyardBatch = [];
  const results = [];

  let mergedCount = 0;
  let skippedCount = 0;
  let repointedEdgesCount = 0;
  let deletedRedundantEdgesCount = 0;
  let mutatedAny = false;

  for (const item of normalizedItems) {
    const itemDryRun = globalDryRun || Boolean(item.dryRun);
    const keepNode = resolveNodeRef(item.keep, nodeById, allNodes, mergedIntoMap);
    const mergeNode = resolveNodeRef(
      item.merge,
      nodeById,
      allNodes,
      mergedIntoMap,
      keepNode?.type || null
    );

    if (!keepNode || !mergeNode) {
      skippedCount += 1;
      results.push({
        status: "skipped",
        reason: "node_not_found",
        keep: item.keep,
        merge: item.merge
      });
      continue;
    }

    if (keepNode.id === mergeNode.id) {
      skippedCount += 1;
      results.push({
        status: "skipped",
        reason: "same_node",
        keepId: keepNode.id,
        mergeId: mergeNode.id
      });
      continue;
    }

    const { finalName, boundedAliases, boundedObs, occurrences } = buildMergedKeepMetadata(
      keepNode,
      mergeNode,
      item.canonicalName
    );

    const mergeIncidentIds = Array.from(edgesByNodeId.get(mergeNode.id) || []).filter((id) =>
      edgeById.has(id)
    );
    const keepIncidentIds = Array.from(edgesByNodeId.get(keepNode.id) || []).filter((id) =>
      edgeById.has(id)
    );

    const seenActiveKeys = new Set();
    for (const eid of keepIncidentIds) {
      const e = edgeById.get(eid);
      if (e && e.isLatest !== false) {
        seenActiveKeys.add(`${e.sourceNodeId}|${e.targetNodeId}|${e.type}`);
      }
    }

    let itemRepointed = 0;
    let itemDeletedRedundant = 0;
    const preMergeEdgesSnapshot = mergeIncidentIds.map((id) => structuredClone(edgeById.get(id)));

    if (itemDryRun) {
      const previewSeen = new Set(seenActiveKeys);
      for (const edge of preMergeEdgesSnapshot) {
        const newSrc = edge.sourceNodeId === mergeNode.id ? keepNode.id : edge.sourceNodeId;
        const newTgt = edge.targetNodeId === mergeNode.id ? keepNode.id : edge.targetNodeId;
        const newKey = `${newSrc}|${newTgt}|${edge.type}`;
        if (newSrc === newTgt || (edge.isLatest !== false && previewSeen.has(newKey))) {
          itemDeletedRedundant += 1;
        } else {
          if (edge.isLatest !== false) previewSeen.add(newKey);
          itemRepointed += 1;
        }
      }

      results.push({
        status: "dry_run",
        keepId: keepNode.id,
        keepName: finalName,
        mergeId: mergeNode.id,
        mergeName: mergeNode.name,
        aliases: boundedAliases,
        sourceObservationIdsCount: boundedObs.length,
        occurrences,
        repointedEdgesCount: itemRepointed,
        deletedRedundantEdgesCount: itemDeletedRedundant
      });
      continue;
    }

    // Live 5-Layer Atomic Merge
    const now = new Date().toISOString();
    mutatedAny = true;
    const matchingFacets = allFacets.filter((f) => f.targetId === mergeNode.id);
    graveyardBatch.push({
      archivedAt: now,
      reason: "semantic_merged",
      mergedIntoId: keepNode.id,
      mergedIntoName: finalName,
      node: structuredClone(mergeNode),
      incidentEdges: preMergeEdgesSnapshot,
      facets: matchingFacets
    });

    // Repoint or delete incident edges across all 5 KV layers
    for (const edge of preMergeEdgesSnapshot) {
      const oldKey = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`;
      const newSrc = edge.sourceNodeId === mergeNode.id ? keepNode.id : edge.sourceNodeId;
      const newTgt = edge.targetNodeId === mergeNode.id ? keepNode.id : edge.targetNodeId;
      const newKey = `${newSrc}|${newTgt}|${edge.type}`;

      if (newSrc === newTgt || (edge.isLatest !== false && seenActiveKeys.has(newKey))) {
        if (control && typeof engine.applyRetrievalRecord === "function") {
          const { next } = await engine.applyRetrievalRecord(control, "edge", edge.id, null);
          control = next;
        }
        await Promise.all([
          engine.kvDelete("mem:graph:edges", edge.id),
          engine.kvDelete("mem:graph:edge-key", oldKey).catch(() => {}),
          engine.kvDelete("mem:graph:edge-history", edge.id).catch(() => {})
        ]);
        edgeById.delete(edge.id);
        edgesByNodeId.get(edge.sourceNodeId)?.delete(edge.id);
        edgesByNodeId.get(edge.targetNodeId)?.delete(edge.id);
        if (edge.sourceNodeId !== mergeNode.id) affectedDegreeNodeIds.add(edge.sourceNodeId);
        if (edge.targetNodeId !== mergeNode.id) affectedDegreeNodeIds.add(edge.targetNodeId);
        itemDeletedRedundant += 1;
        deletedRedundantEdgesCount += 1;
      } else {
        if (edge.isLatest !== false) seenActiveKeys.add(newKey);
        await engine.kvDelete("mem:graph:edge-key", oldKey).catch(() => {});
        const updatedEdge = {
          ...edge,
          sourceNodeId: newSrc,
          targetNodeId: newTgt,
          updatedAt: now
        };
        const writes = [engine.kvSet("mem:graph:edges", edge.id, updatedEdge)];
        if (updatedEdge.isLatest !== false) {
          writes.push(engine.kvSet("mem:graph:edge-key", newKey, edge.id));
        }
        await Promise.all(writes);
        if (control && typeof engine.applyRetrievalRecord === "function") {
          const { next } = await engine.applyRetrievalRecord(
            control,
            "edge",
            edge.id,
            updatedEdge
          );
          control = next;
        }
        edgeById.set(edge.id, updatedEdge);
        edgesByNodeId.get(mergeNode.id)?.delete(edge.id);
        if (!edgesByNodeId.has(keepNode.id)) edgesByNodeId.set(keepNode.id, new Set());
        edgesByNodeId.get(keepNode.id).add(edge.id);
        itemRepointed += 1;
        repointedEdgesCount += 1;
      }
    }

    // Delete merged node from all 5 KV layers
    if (control && typeof engine.applyRetrievalRecord === "function") {
      const { next } = await engine.applyRetrievalRecord(control, "node", mergeNode.id, null);
      control = next;
    }
    await Promise.all([
      engine.kvDelete("mem:graph:nodes", mergeNode.id),
      engine.kvDelete("mem:graph:node-degree", mergeNode.id),
      engine.kvDelete("mem:graph:name-index", `${mergeNode.type}|${mergeNode.name}`).catch(() => {}),
      engine.kvDelete("mem:graph:membership", mergeNode.id).catch(() => {}),
      ...matchingFacets.map((f) => engine.kvDelete("mem:facets", f.id).catch(() => {}))
    ]);

    nodeById.delete(mergeNode.id);
    mergedIntoMap.set(mergeNode.id, keepNode.id);

    // Update keepNode across all 5 KV layers
    if (keepNode.name !== finalName) {
      await engine
        .kvDelete("mem:graph:name-index", `${keepNode.type}|${keepNode.name}`)
        .catch(() => {});
    }
    const updatedKeep = {
      ...keepNode,
      name: finalName,
      sourceObservationIds: boundedObs,
      properties: {
        ...(keepNode.properties || {}),
        occurrences
      },
      updatedAt: now
    };
    if (boundedAliases.length > 0) {
      updatedKeep.aliases = boundedAliases;
    } else {
      delete updatedKeep.aliases;
    }

    await Promise.all([
      engine.kvSet("mem:graph:nodes", keepNode.id, updatedKeep),
      engine.kvSet("mem:graph:name-index", `${updatedKeep.type}|${updatedKeep.name}`, keepNode.id)
    ]);
    if (control && typeof engine.applyRetrievalRecord === "function") {
      const { next } = await engine.applyRetrievalRecord(
        control,
        "node",
        keepNode.id,
        updatedKeep
      );
      control = next;
    }

    nodeById.set(keepNode.id, updatedKeep);
    affectedDegreeNodeIds.add(keepNode.id);
    mergedCount += 1;

    results.push({
      status: "merged",
      keepId: keepNode.id,
      keepName: finalName,
      mergeId: mergeNode.id,
      mergeName: mergeNode.name,
      aliases: boundedAliases,
      sourceObservationIdsCount: boundedObs.length,
      occurrences,
      repointedEdgesCount: itemRepointed,
      deletedRedundantEdgesCount: itemDeletedRedundant
    });
  }

  let graveyardEntriesWritten = 0;
  if (mutatedAny) {
    // Recompute accurate degrees for affected nodes
    const degMap = new Map();
    for (const e of edgeById.values()) {
      degMap.set(e.sourceNodeId, (degMap.get(e.sourceNodeId) || 0) + 1);
      degMap.set(e.targetNodeId, (degMap.get(e.targetNodeId) || 0) + 1);
    }
    for (const nid of affectedDegreeNodeIds) {
      if (nodeById.has(nid)) {
        await engine.kvSet("mem:graph:node-degree", nid, degMap.get(nid) || 0);
      }
    }

    graveyardEntriesWritten = appendToGraveyard(graveyardBatch, graveyardPath);
    await triggerSnapshotRebuild(deps);
  }

  return {
    status: globalDryRun ? "dry_run" : "semantic_merged",
    version: "4.0",
    dryRun: globalDryRun,
    requestedCount: normalizedItems.length,
    mergedCount,
    skippedCount,
    repointedEdgesCount,
    deletedRedundantEdgesCount,
    graveyardEntriesWritten,
    graveyardFile: graveyardPath,
    results,
    totalStoreNodes: control?.nodes ?? null,
    totalStoreEdges: control?.edges ?? null
  };
}

function shardForObservation(obsId) {
  let hash = 5381;
  for (let i = 0; i < obsId.length; i++) {
    hash = ((hash << 5) + hash + obsId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 64;
}

async function lookupObservationsByIds(engine, obsIds) {
  const obsById = new Map();
  const needed = Array.from(new Set(obsIds.filter((id) => typeof id === "string" && id.length > 0)));
  if (!needed.length || !engine) return obsById;

  const remaining = new Set(needed);

  // Strategy 1: O(1) lookup via mem:idx:obs:<shard> -> mem:obs:<sessionId>
  if (typeof engine.kvGet === "function") {
    for (let i = 0; i < needed.length; i += 24) {
      const chunk = needed.slice(i, i + 24);
      const sessionIds = await Promise.all(
        chunk.map((id) =>
          engine.kvGet(`mem:idx:obs:${shardForObservation(id)}`, id).catch(() => null)
        )
      );
      await Promise.all(
        chunk.map(async (id, idx) => {
          const sid = sessionIds[idx];
          if (typeof sid !== "string" || !sid) return;
          const obs = await engine.kvGet(`mem:obs:${sid}`, id).catch(() => null);
          if (obs && obs.id) {
            obsById.set(obs.id, obs);
            remaining.delete(obs.id);
          }
        })
      );
    }
  }

  // Strategy 2: Scan mem:sessions -> mem:obs:<sessionId> for any unresolved IDs
  if (remaining.size > 0 && typeof engine.kvList === "function") {
    const sessions = (await engine.kvList("mem:sessions").catch(() => [])) || [];
    for (const s of sessions) {
      if (remaining.size === 0) break;
      const sid = typeof s === "string" ? s : s?.id;
      if (!sid) continue;
      const obsList = (await engine.kvList(`mem:obs:${sid}`).catch(() => [])) || [];
      for (const obs of obsList) {
        if (obs && obs.id && remaining.has(obs.id)) {
          obsById.set(obs.id, obs);
          remaining.delete(obs.id);
        }
      }
    }
  }

  return obsById;
}

function classifyDomain(node) {
  const name = normalizeSemanticKey(node?.name || "");
  const type = node?.type || "concept";

  if (
    type === "song" ||
    node?.properties?.artist ||
    node?.properties?.category === "song title" ||
    name.includes("hollywood tonight") ||
    name.includes("michael jackson") ||
    name.includes("flac") ||
    name.includes("coreaudio") ||
    name.includes("sample rate")
  ) {
    return THEMATIC_DOMAINS[4];
  }

  let best = THEMATIC_DOMAINS[5];
  let bestScore = 0;
  for (const d of THEMATIC_DOMAINS) {
    let score = 0;
    for (const kw of d.keywords) {
      if (name.includes(kw)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }

  if (type === "file" && name.includes("dart")) return THEMATIC_DOMAINS[3];
  if (type === "file" && (name.includes("smart-router") || name.includes("router"))) {
    return THEMATIC_DOMAINS[0];
  }
  if (type === "file" && name.includes("audio")) return THEMATIC_DOMAINS[4];
  return best;
}

async function fetchViewGraph(deps) {
  if (typeof deps?.queryGraph === "function") {
    return deps.queryGraph(deps.secret, 500);
  }
  if (deps?.secret && typeof fetch === "function") {
    const baseUrl = deps.baseUrl || DEFAULT_BASE_URL;
    const res = await fetch(`${baseUrl}/agentmemory/graph/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ limit: 500 })
    });
    if (!res.ok) throw new Error(`graph/query failed: HTTP ${res.status}`);
    const data = await res.json();
    return {
      data,
      nodes: data.nodes || [],
      edges: data.edges || []
    };
  }
  return null;
}

/**
 * Gathers view unlinked or low-degree (<= 1) related_to-only nodes with short context excerpts
 * from mem:obs:* (matched via sourceObservationIds) and top candidate domain hubs for Gemini 4 Hydrogen.
 */
export async function buildSemanticLinkBatch(deps, options = {}) {
  const engine = deps?.engine;
  if (!engine) throw new Error("buildSemanticLinkBatch requires deps.engine");

  const limit = Math.max(1, Number(options.limit ?? 40));
  const maxObsPerNode = Math.max(1, Number(options.maxObsPerNode ?? 3));
  const maxExcerptChars = Math.max(80, Number(options.maxExcerptChars ?? 240));
  const hubLimit = Math.max(6, Number(options.hubLimit ?? 18));

  const [viewRes, allNodesRaw, allEdgesRaw] = await Promise.all([
    fetchViewGraph(deps).catch(() => null),
    engine.kvList("mem:graph:nodes"),
    engine.kvList("mem:graph:edges")
  ]);

  const storeNodes = (allNodesRaw || []).filter((n) => n && n.id && n.name && !n.stale);
  const storeEdges = (allEdgesRaw || []).filter(
    (e) => e && e.id && !e.stale && e.isLatest !== false
  );
  const storeNodeById = new Map(storeNodes.map((n) => [n.id, n]));

  const viewNodes = viewRes?.nodes?.length
    ? viewRes.nodes.filter((n) => n && n.id && !n.stale)
    : storeNodes.slice(0, 500);
  const viewEdges = viewRes?.edges
    ? viewRes.edges.filter((e) => e && e.id && !e.stale && e.isLatest !== false)
    : storeEdges;

  const viewIncidentById = new Map();
  for (const e of viewEdges) {
    if (!viewIncidentById.has(e.sourceNodeId)) viewIncidentById.set(e.sourceNodeId, []);
    if (!viewIncidentById.has(e.targetNodeId)) viewIncidentById.set(e.targetNodeId, []);
    viewIncidentById.get(e.sourceNodeId).push(e);
    viewIncidentById.get(e.targetNodeId).push(e);
  }

  const globalDeg = new Map();
  for (const e of storeEdges) {
    globalDeg.set(e.sourceNodeId, (globalDeg.get(e.sourceNodeId) || 0) + 1);
    globalDeg.set(e.targetNodeId, (globalDeg.get(e.targetNodeId) || 0) + 1);
  }

  const unlinkedCandidates = [];
  const relatedOnlyCandidates = [];

  for (const vn of viewNodes) {
    const full = storeNodeById.get(vn.id) || vn;
    if (isTransientScratchNode(full)) continue;
    const cleanName = normalizeSemanticText(full.name);
    if (!cleanName || HALLUCINATION_REGEX.test(cleanName)) continue;
    if (CJK_REGEX.test(cleanName) && !CJK_CANONICAL_MAP.has(cleanName)) continue;

    const inc = viewIncidentById.get(full.id) || [];
    const deg = inc.length;

    if (deg === 0) {
      unlinkedCandidates.push({ node: full, viewDegree: 0, incidentEdges: inc });
    } else if (deg <= 1 && inc.every((e) => e.type === "related_to")) {
      relatedOnlyCandidates.push({ node: full, viewDegree: deg, incidentEdges: inc });
    }
  }

  const selected = [...unlinkedCandidates, ...relatedOnlyCandidates].slice(0, limit);

  // Gather needed observation IDs across selected nodes
  const neededObsIds = [];
  for (const entry of selected) {
    const obsIds = Array.isArray(entry.node.sourceObservationIds)
      ? entry.node.sourceObservationIds.slice(-maxObsPerNode)
      : [];
    for (const oid of obsIds) neededObsIds.push(oid);
  }
  const obsById = await lookupObservationsByIds(engine, neededObsIds);

  // Identify top candidate domain hubs from view + store
  const hubPool = (viewNodes.length ? viewNodes : storeNodes)
    .map((n) => storeNodeById.get(n.id) || n)
    .filter((n) => {
      if (!n || !n.id || !n.name || n.stale || isTransientScratchNode(n)) return false;
      const gDeg = globalDeg.get(n.id) || 0;
      const vDeg = (viewIncidentById.get(n.id) || []).length;
      return Math.max(gDeg, vDeg) >= 2;
    })
    .map((n) => {
      const domain = classifyDomain(n);
      const deg = globalDeg.get(n.id) || (viewIncidentById.get(n.id) || []).length;
      return {
        id: n.id,
        type: n.type,
        name: n.name,
        domainId: domain.id,
        domainLabel: domain.label,
        degree: deg
      };
    });

  // Prefer balanced hubs (degree 2..25) first so we don't overload extreme super-hubs
  hubPool.sort((a, b) => {
    const aPen = a.degree > 25 ? a.degree : 0;
    const bPen = b.degree > 25 ? b.degree : 0;
    return aPen - bPen || b.degree - a.degree || String(a.id).localeCompare(String(b.id));
  });

  const hubsByDomain = new Map();
  for (const d of THEMATIC_DOMAINS) hubsByDomain.set(d.id, []);
  for (const hub of hubPool) {
    hubsByDomain.get(hub.domainId)?.push(hub);
  }
  const topDomainHubs = hubPool.slice(0, hubLimit);

  const items = selected.map(({ node, viewDegree, incidentEdges }) => {
    const domain = classifyDomain(node);
    const obsIds = Array.isArray(node.sourceObservationIds)
      ? node.sourceObservationIds.slice(-maxObsPerNode)
      : [];
    const observationExcerpts = [];
    const timestamps = [];

    for (const oid of obsIds) {
      const obs = obsById.get(oid);
      if (!obs) continue;
      const ts = obs.timestamp || obs.createdAt || null;
      if (ts) timestamps.push(ts);
      const rawText = [obs.narrative, ...(obs.facts || [])].filter(Boolean).join(" | ");
      observationExcerpts.push({
        id: obs.id,
        type: obs.type || "observation",
        timestamp: ts,
        title: truncateSafe(obs.title, 100),
        excerpt: truncateSafe(rawText, maxExcerptChars),
        concepts: Array.isArray(obs.concepts) ? obs.concepts.slice(0, 8) : [],
        files: Array.isArray(obs.files) ? obs.files.slice(0, 8) : []
      });
    }

    timestamps.sort();
    const sameDomainHubs = (hubsByDomain.get(domain.id) || [])
      .filter((h) => h.id !== node.id)
      .slice(0, 4);
    const fallbackHubs = topDomainHubs
      .filter((h) => h.id !== node.id && !sameDomainHubs.some((s) => s.id === h.id))
      .slice(0, Math.max(0, 5 - sameDomainHubs.length));

    const existingEdges = incidentEdges.map((e) => {
      const otherId = e.sourceNodeId === node.id ? e.targetNodeId : e.sourceNodeId;
      const other = storeNodeById.get(otherId);
      return {
        edgeId: e.id,
        type: e.type,
        direction: e.sourceNodeId === node.id ? "outgoing" : "incoming",
        otherNodeId: otherId,
        otherNodeName: other?.name || otherId,
        weight: e.weight,
        tvalid: e.tvalid || null
      };
    });

    return {
      id: node.id,
      type: node.type,
      name: node.name,
      domainId: domain.id,
      domainLabel: domain.label,
      viewDegree,
      globalDegree: globalDeg.get(node.id) || viewDegree,
      existingEdges,
      sourceObservationIds: obsIds,
      observationExcerpts,
      candidateHubs: [...sameDomainHubs, ...fallbackHubs],
      temporalHints: {
        oldestObsTimestamp: timestamps[0] || node.createdAt || null,
        latestObsTimestamp: timestamps[timestamps.length - 1] || node.updatedAt || null,
        suggestedDomainAnchor: domain.anchor
      }
    };
  });

  return {
    status: "link_batch_ready",
    version: "4.0",
    limit,
    viewNodesCount: viewNodes.length,
    unlinkedCount: unlinkedCandidates.length,
    lowDegreeRelatedOnlyCount: relatedOnlyCandidates.length,
    batchCount: items.length,
    observationsMatchedCount: obsById.size,
    allowedRelations: [
      "implements",
      "configures",
      "replaces",
      "caused_by",
      "optimizes",
      "fixes",
      "depends_on",
      "uses",
      "imports",
      "modifies",
      "causes"
    ],
    domainHubs: topDomainHubs,
    items
  };
}

function parseOptionalTemporalDate(val) {
  if (val === undefined || val === null || val === "" || val === "unknown" || val === "current") {
    return { ok: true, iso: undefined };
  }
  if (typeof val !== "string") return { ok: false, error: "temporal timestamp must be a string" };
  const ms = Date.parse(val);
  if (!Number.isFinite(ms)) return { ok: false, error: `invalid temporal timestamp: ${val}` };
  return { ok: true, iso: new Date(ms).toISOString() };
}

function findSupersededEdges(supersedesRef, sourceNode, targetNode, allEdges, allNodes, newEdgeId) {
  if (!supersedesRef) return [];

  const activeEdges = allEdges.filter(
    (e) => e && e.id && e.id !== newEdgeId && !e.stale && e.isLatest !== false
  );

  // 1. Direct edge ID or object with edgeId
  const explicitEdgeId = typeof supersedesRef === "object" ? supersedesRef.edgeId : null;
  const refStr =
    typeof supersedesRef === "string"
      ? supersedesRef
      : supersedesRef?.target || supersedesRef?.name || supersedesRef?.id || "";

  if (explicitEdgeId) {
    const match = activeEdges.find((e) => e.id === explicitEdgeId);
    return match ? [match] : [];
  }
  if (typeof refStr === "string" && refStr.startsWith("ge_")) {
    const match = activeEdges.find((e) => e.id === refStr);
    if (match) return [match];
  }

  // 2. Resolve older target/source node by ID or name
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));
  const oldNode = resolveNodeRef(refStr, nodeById, allNodes);
  if (!oldNode) return [];

  const desiredOldType = typeof supersedesRef === "object" ? supersedesRef.type : null;
  const matchesType = (e) => !desiredOldType || e.type === desiredOldType;

  // Prefer sourceNode -> oldNode, then oldNode -> targetNode, then undirected incident between sourceNode/targetNode & oldNode
  let matched = activeEdges.filter(
    (e) =>
      matchesType(e) &&
      sourceNode &&
      e.sourceNodeId === sourceNode.id &&
      e.targetNodeId === oldNode.id
  );
  if (!matched.length && targetNode) {
    matched = activeEdges.filter(
      (e) => matchesType(e) && e.sourceNodeId === oldNode.id && e.targetNodeId === targetNode.id
    );
  }
  if (!matched.length && sourceNode) {
    matched = activeEdges.filter(
      (e) => matchesType(e) && e.sourceNodeId === oldNode.id && e.targetNodeId === sourceNode.id
    );
  }
  return matched;
}

async function postDirectGraphXml(deps, rels) {
  if (typeof deps?.applyDirectXmlLinks === "function") {
    return deps.applyDirectXmlLinks(deps.secret, [], rels, { preserveRelationType: true });
  }
  if (!deps?.secret || typeof fetch !== "function") {
    return { success: true, edgesAdded: 0, nodesAdded: 0, skippedHttp: true };
  }

  const baseUrl = deps.baseUrl || DEFAULT_BASE_URL;
  let totalEdgesAdded = 0;
  let totalNodesAdded = 0;

  const batches = [];
  for (const r of rels) {
    const sType = r.sourceType || "concept";
    const tType = r.targetType || "concept";
    if (r.source === r.target) continue;
    let placed = false;
    for (const batch of batches) {
      const es = batch.entityTypeByName.get(r.source);
      const et = batch.entityTypeByName.get(r.target);
      if ((!es || es === sType) && (!et || et === tType)) {
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
          `<relationship type="${escapeXml(r.type)}" source="${escapeXml(
            r.source
          )}" target="${escapeXml(r.target)}" weight="${r.weight ?? 0.9}"/>`
      )
      .join("");

    const res = await fetch(`${baseUrl}/agentmemory/graph/extract`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.secret}`,
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

  return { success: true, edgesAdded: totalEdgesAdded, nodesAdded: totalNodesAdded };
}

function normalizeCollapsedDirectType(relType) {
  const clean = String(relType || "related_to").toLowerCase().trim();
  if (clean === "optimizes_for") return "modifies";
  if (clean === "caused_by") return "causes";
  if (clean === "blocked_by") return "depends_on";
  return BASE_DIRECT_XML_RELATIONS.has(clean) ? clean : "related_to";
}

/**
 * Validates and applies bi-temporal semantic triples (supporting tvalid, tvalidEnd,
 * supersedes, replaces via DIRECT_GRAPH_XML + marking superseded edges' isLatest: false / tvalidEnd
 * across mem:graph:edges, mem:graph:edge-history, and retrieval index).
 */
export async function applyTemporalLinks(deps, triples, options = {}) {
  const engine = deps?.engine || null;
  const globalDryRun = Boolean(options.dryRun);

  const rawList = Array.isArray(triples)
    ? triples
    : Array.isArray(triples?.triples)
    ? triples.triples
    : Array.isArray(triples?.links)
    ? triples.links
    : [];

  let allNodes = [];
  let allEdges = [];
  if (engine) {
    const [nodesRaw, edgesRaw] = await Promise.all([
      engine.kvList("mem:graph:nodes"),
      engine.kvList("mem:graph:edges")
    ]);
    allNodes = (nodesRaw || []).filter((n) => n && n.id && !n.stale);
    allEdges = (edgesRaw || []).filter((e) => e && e.id && !e.stale);
  }
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));

  const resolveEndpoint = (rawRef, explicitType) => {
    const refStr = normalizeSemanticText(rawRef);
    const existing =
      resolveNodeRef(rawRef, nodeById, allNodes, null, explicitType) ||
      allNodes.find(
        (n) =>
          (!explicitType || n.type === explicitType) &&
          Array.isArray(n.aliases) &&
          n.aliases.some((a) => normalizeSemanticKey(a) === normalizeSemanticKey(refStr))
      );
    if (existing) {
      return { id: existing.id, name: existing.name, type: explicitType || existing.type, existing };
    }
    return { id: null, name: refStr, type: explicitType || "concept", existing: null };
  };

  const validTriples = [];
  const rejected = [];

  for (let idx = 0; idx < rawList.length; idx++) {
    const item = rawList[idx];
    if (!item || typeof item !== "object") {
      rejected.push({ index: idx, item, reason: "triple_must_be_object" });
      continue;
    }
    const rawSource = item.source ?? item.sourceName;
    const rawTarget = item.target ?? item.targetName;
    const rawRel = item.type || item.relation;
    if (!rawSource || !rawTarget || !rawRel) {
      rejected.push({ index: idx, item, reason: "missing_source_target_or_type" });
      continue;
    }

    const relType = String(rawRel).toLowerCase().trim();
    if (!SEMANTIC_RELATIONS.has(relType)) {
      rejected.push({ index: idx, item, reason: `unsupported_relation:${relType}` });
      continue;
    }

    const src = resolveEndpoint(rawSource, item.sourceType);
    const tgt = resolveEndpoint(rawTarget, item.targetType);
    if (!src.name || !tgt.name) {
      rejected.push({ index: idx, item, reason: "empty_endpoint_name" });
      continue;
    }
    if (
      isTransientScratchNode({ name: src.name }) ||
      isTransientScratchNode({ name: tgt.name })
    ) {
      rejected.push({ index: idx, item, reason: "transient_scratch_endpoint" });
      continue;
    }
    if (
      (CJK_REGEX.test(src.name) && !CJK_CANONICAL_MAP.has(src.name)) ||
      (CJK_REGEX.test(tgt.name) && !CJK_CANONICAL_MAP.has(tgt.name))
    ) {
      rejected.push({ index: idx, item, reason: "unmapped_cjk_endpoint" });
      continue;
    }
    if (
      (src.id && tgt.id && src.id === tgt.id) ||
      (normalizeSemanticKey(src.name) === normalizeSemanticKey(tgt.name) && src.type === tgt.type)
    ) {
      rejected.push({ index: idx, item, reason: "self_loop_rejected" });
      continue;
    }

    const parsedWeight = item.weight === undefined ? 0.9 : Number(item.weight);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0 || parsedWeight > 1) {
      rejected.push({ index: idx, item, reason: `invalid_weight:${item.weight}` });
      continue;
    }

    const tvStart = parseOptionalTemporalDate(item.tvalid ?? item.validFrom ?? item.valid_from);
    if (!tvStart.ok) {
      rejected.push({ index: idx, item, reason: tvStart.error });
      continue;
    }
    const tvEnd = parseOptionalTemporalDate(item.tvalidEnd ?? item.validTo ?? item.valid_to);
    if (!tvEnd.ok) {
      rejected.push({ index: idx, item, reason: tvEnd.error });
      continue;
    }
    if (tvStart.iso && tvEnd.iso && Date.parse(tvEnd.iso) < Date.parse(tvStart.iso)) {
      rejected.push({ index: idx, item, reason: "tvalidEnd_before_tvalid" });
      continue;
    }

    const supersedesRef =
      item.supersedes ??
      (typeof item.replaces === "string" && relType !== "replaces" ? item.replaces : undefined);

    validTriples.push({
      index: idx,
      source: src.name,
      sourceType: src.type,
      sourceExistingId: src.id,
      target: tgt.name,
      targetType: tgt.type,
      targetExistingId: tgt.id,
      type: relType,
      weight: Number(parsedWeight.toFixed(4)),
      tvalid: tvStart.iso,
      tvalidEnd: tvEnd.iso,
      supersedes: supersedesRef,
      reasoning: typeof item.reasoning === "string" ? item.reasoning.trim() : undefined,
      sentiment: typeof item.sentiment === "string" ? item.sentiment.trim() : undefined,
      confidence:
        typeof item.confidence === "number" && Number.isFinite(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : Number(parsedWeight.toFixed(4)),
      sourceObservationIds: Array.isArray(item.sourceObservationIds)
        ? item.sourceObservationIds.slice(0, MAX_NODE_SOURCE_OBS)
        : [],
      dryRun: globalDryRun || Boolean(item.dryRun)
    });
  }

  const liveTriples = validTriples.filter((t) => !t.dryRun);
  if (globalDryRun || liveTriples.length === 0) {
    const preview = validTriples.map((t) => {
      const srcNode = t.sourceExistingId ? nodeById.get(t.sourceExistingId) : null;
      const tgtNode = t.targetExistingId ? nodeById.get(t.targetExistingId) : null;
      const toSupersede = findSupersededEdges(t.supersedes, srcNode, tgtNode, allEdges, allNodes);
      return {
        source: t.source,
        target: t.target,
        type: t.type,
        tvalid: t.tvalid || null,
        tvalidEnd: t.tvalidEnd || null,
        wouldSupersedeEdgeIds: toSupersede.map((e) => e.id),
        status: t.dryRun ? "dry_run" : "pending"
      };
    });
    return {
      status: globalDryRun ? "dry_run" : rejected.length ? "validation_failed" : "nothing_to_apply",
      version: "4.0",
      dryRun: globalDryRun,
      requestedCount: rawList.length,
      validCount: validTriples.length,
      rejectedCount: rejected.length,
      rejected,
      appliedEdgesCount: 0,
      supersededEdgesCount: 0,
      supersededEdgeIds: [],
      applied: preview,
      totalStoreNodes: null,
      totalStoreEdges: null
    };
  }

  const beforeEdgeIds = new Set(allEdges.map((e) => e.id));
  const xmlPayload = liveTriples.map((t) => ({
    source: t.source,
    sourceType: t.sourceType,
    target: t.target,
    targetType: t.targetType,
    type: t.type,
    weight: t.weight
  }));

  const directResult = await postDirectGraphXml(deps, xmlPayload);

  if (!engine) {
    return {
      status: "temporal_links_applied",
      version: "4.0",
      dryRun: false,
      requestedCount: rawList.length,
      validCount: validTriples.length,
      rejectedCount: rejected.length,
      rejected,
      appliedEdgesCount: directResult?.edgesAdded || liveTriples.length,
      supersededEdgesCount: 0,
      supersededEdgeIds: [],
      applied: liveTriples.map((t) => ({
        source: t.source,
        target: t.target,
        type: t.type,
        tvalid: t.tvalid || null,
        tvalidEnd: t.tvalidEnd || null,
        supersededEdgeIds: []
      })),
      totalStoreNodes: null,
      totalStoreEdges: null
    };
  }

  // Reconcile created edges, exact rich edge types, temporal metadata & superseded history across 5 KV layers
  const [afterNodesRaw, afterEdgesRaw, initialControl] = await Promise.all([
    engine.kvList("mem:graph:nodes"),
    engine.kvList("mem:graph:edges"),
    engine.kvGet("mem:graph:retrieval-control", "current").catch(() => null)
  ]);

  let control = initialControl;
  const currentNodes = (afterNodesRaw || []).filter((n) => n && n.id && !n.stale);
  const currentEdges = (afterEdgesRaw || []).filter((e) => e && e.id && !e.stale);
  const currentNodeById = new Map(currentNodes.map((n) => [n.id, structuredClone(n)]));
  const currentEdgeById = new Map(currentEdges.map((e) => [e.id, structuredClone(e)]));
  const now = new Date().toISOString();

  const ensureNode = async (name, type) => {
    const existing = resolveNodeRef(name, currentNodeById, currentNodes, null, type);
    if (existing) return existing;
    const newNode = {
      id: generateId("gn"),
      type,
      name,
      properties: {},
      sourceObservationIds: [],
      createdAt: now
    };
    await Promise.all([
      engine.kvSet("mem:graph:nodes", newNode.id, newNode),
      engine.kvSet("mem:graph:name-index", `${newNode.type}|${newNode.name}`, newNode.id),
      engine.kvSet("mem:graph:node-degree", newNode.id, 0)
    ]);
    if (control && typeof engine.applyRetrievalRecord === "function") {
      const { next } = await engine.applyRetrievalRecord(control, "node", newNode.id, newNode);
      control = next;
    }
    currentNodes.push(newNode);
    currentNodeById.set(newNode.id, newNode);
    return newNode;
  };

  const touchedNodeIds = new Set();
  const supersededEdgeIds = [];
  const applied = [];
  let appliedEdgesCount = 0;
  let supersededEdgesCount = 0;

  for (const t of liveTriples) {
    const sNode = await ensureNode(t.source, t.sourceType);
    const tNode = await ensureNode(t.target, t.targetType);
    const collapsedType = normalizeCollapsedDirectType(t.type);

    // Locate newly created edge from DIRECT_GRAPH_XML, or exact matching active edge
    let edge = Array.from(currentEdgeById.values()).find(
      (e) =>
        !beforeEdgeIds.has(e.id) &&
        e.sourceNodeId === sNode.id &&
        e.targetNodeId === tNode.id &&
        (e.type === t.type || e.type === collapsedType)
    );

    const isNewlyCreatedByDirect = Boolean(edge);
    if (!edge) {
      const existingSameEdge = Array.from(currentEdgeById.values()).find(
        (e) =>
          e.sourceNodeId === sNode.id &&
          e.targetNodeId === tNode.id &&
          e.type === t.type &&
          e.isLatest !== false
      );
      if (existingSameEdge) {
        // When edge.supersedes explicitly targets this triple/edge ID, mint a new versioned edge
        // instead of mutating the superseded edge in-place.
        const supersedesSameEdge =
          t.supersedes &&
          findSupersededEdges(t.supersedes, sNode, tNode, [existingSameEdge], currentNodes, null)
            .length > 0;
        if (!supersedesSameEdge) {
          edge = existingSameEdge;
        }
      }
    }

    let edgeNeedsPersist = false;
    const oldEdgeKeyBeforeUpgrade =
      edge && edge.type !== t.type
        ? `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`
        : null;

    if (!edge) {
      edge = {
        id: generateId("ge"),
        type: t.type,
        sourceNodeId: sNode.id,
        targetNodeId: tNode.id,
        weight: t.weight,
        sourceObservationIds: t.sourceObservationIds,
        createdAt: now,
        tcommit: now,
        version: 1,
        isLatest: true
      };
      edgeNeedsPersist = true;
      touchedNodeIds.add(sNode.id);
      touchedNodeIds.add(tNode.id);
    } else if (isNewlyCreatedByDirect || edge.type !== t.type) {
      edge.type = t.type;
      edge.weight = t.weight;
      edge.tcommit = edge.tcommit || now;
      edge.version = edge.version || 1;
      edge.isLatest = true;
      if (t.sourceObservationIds.length > 0) {
        edge.sourceObservationIds = Array.from(
          new Set([...(edge.sourceObservationIds || []), ...t.sourceObservationIds])
        ).slice(-MAX_NODE_SOURCE_OBS);
      }
      edgeNeedsPersist = true;
    }

    if (t.tvalid) {
      edge.tvalid = t.tvalid;
      edgeNeedsPersist = true;
    }
    if (t.tvalidEnd) {
      edge.tvalidEnd = t.tvalidEnd;
      edgeNeedsPersist = true;
    }
    if (t.reasoning || t.sentiment) {
      edge.context = {
        ...(edge.context || {}),
        ...(t.reasoning ? { reasoning: t.reasoning } : {}),
        ...(t.sentiment ? { sentiment: t.sentiment } : {}),
        confidence: t.confidence
      };
      edgeNeedsPersist = true;
    }

    // Handle edge.supersedes -> mark older edge(s) isLatest: false / tvalidEnd across KV & retrieval index
    const toSupersede = findSupersededEdges(
      t.supersedes,
      sNode,
      tNode,
      Array.from(currentEdgeById.values()),
      currentNodes,
      edge.id
    );

    let maxOldVersion = 0;
    const localSupersededIds = [];
    for (const oldEdge of toSupersede) {
      maxOldVersion = Math.max(maxOldVersion, Number(oldEdge.version) || 1);
      const updatedOld = {
        ...oldEdge,
        isLatest: false,
        tvalidEnd: oldEdge.tvalidEnd || t.tvalidEnd || t.tvalid || now,
        supersededBy: edge.id,
        updatedAt: now
      };
      const oldKey = `${oldEdge.sourceNodeId}|${oldEdge.targetNodeId}|${oldEdge.type}`;
      const newKey = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`;
      const ops = [
        engine.kvSet("mem:graph:edges", updatedOld.id, updatedOld),
        engine.kvSet("mem:graph:edge-history", updatedOld.id, updatedOld)
      ];
      if (oldKey !== newKey) {
        ops.push(engine.kvDelete("mem:graph:edge-key", oldKey).catch(() => {}));
      }
      await Promise.all(ops);

      if (control && typeof engine.applyRetrievalRecord === "function") {
        const { next: nextEdgeIdx } = await engine.applyRetrievalRecord(
          control,
          "edge",
          updatedOld.id,
          updatedOld
        );
        control = nextEdgeIdx;
        const { next: nextHistIdx } = await engine.applyRetrievalRecord(
          control,
          "history",
          updatedOld.id,
          updatedOld
        );
        control = nextHistIdx;
      }

      currentEdgeById.set(updatedOld.id, updatedOld);
      supersededEdgeIds.push(updatedOld.id);
      localSupersededIds.push(updatedOld.id);
      supersededEdgesCount += 1;
    }

    if (maxOldVersion > 0) {
      edge.version = Math.max(Number(edge.version) || 1, maxOldVersion + 1);
      edgeNeedsPersist = true;
    }

    if (edgeNeedsPersist) {
      if (oldEdgeKeyBeforeUpgrade) {
        await engine.kvDelete("mem:graph:edge-key", oldEdgeKeyBeforeUpgrade).catch(() => {});
      }
      const edgeKeyStr = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`;
      await Promise.all([
        engine.kvSet("mem:graph:edges", edge.id, edge),
        engine.kvSet("mem:graph:edge-key", edgeKeyStr, edge.id)
      ]);
      if (control && typeof engine.applyRetrievalRecord === "function") {
        const { next } = await engine.applyRetrievalRecord(control, "edge", edge.id, edge);
        control = next;
      }
      currentEdgeById.set(edge.id, edge);
    }

    appliedEdgesCount += 1;
    applied.push({
      edgeId: edge.id,
      source: sNode.name,
      sourceId: sNode.id,
      target: tNode.name,
      targetId: tNode.id,
      type: edge.type,
      weight: edge.weight,
      version: edge.version || 1,
      isLatest: edge.isLatest !== false,
      tvalid: edge.tvalid || null,
      tvalidEnd: edge.tvalidEnd || null,
      supersededEdgeIds: localSupersededIds
    });
  }

  // Update node degrees for any newly inserted KV nodes/edges
  if (touchedNodeIds.size > 0) {
    const degMap = new Map();
    for (const e of currentEdgeById.values()) {
      degMap.set(e.sourceNodeId, (degMap.get(e.sourceNodeId) || 0) + 1);
      degMap.set(e.targetNodeId, (degMap.get(e.targetNodeId) || 0) + 1);
    }
    for (const nid of touchedNodeIds) {
      await engine.kvSet("mem:graph:node-degree", nid, degMap.get(nid) || 0);
    }
  }

  await triggerSnapshotRebuild(deps);

  return {
    status: "temporal_links_applied",
    version: "4.0",
    dryRun: false,
    requestedCount: rawList.length,
    validCount: validTriples.length,
    rejectedCount: rejected.length,
    rejected,
    appliedEdgesCount,
    supersededEdgesCount,
    supersededEdgeIds,
    applied,
    totalStoreNodes: control?.nodes ?? null,
    totalStoreEdges: control?.edges ?? null
  };
}
