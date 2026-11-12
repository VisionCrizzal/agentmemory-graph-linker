# AgentMemory Knowledge Graph Linker, Semantic Planner, Edge Compactor & Smart AI Router (v4.0)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Companion for AgentMemory](https://img.shields.io/badge/Companion%20For-rohitg00%2Fagentmemory-blue.svg)](https://github.com/rohitg00/agentmemory)

🌐 **Language / Ngôn ngữ:** **🇬🇧 English** | [🇻🇳 Tiếng Việt](./README-VN.md)

> [!IMPORTANT]
> **Prerequisite / Ecosystem Requirement:**
> This toolkit is a companion skill built specifically for **[AgentMemory (`rohitg00/agentmemory`)](https://github.com/rohitg00/agentmemory)**.
> It interacts directly with the `@agentmemory/agentmemory` daemon, `iii-sdk` WebSocket (`ws://127.0.0.1:49134`), and Knowledge Graph (`http://localhost:3113/#graph`). You must have [AgentMemory](https://github.com/rohitg00/agentmemory) installed and running to use it.

A **Hybrid Neuro-Symbolic Antigravity Skill (`agentmemory-graph-linker`)** and **Task-Aware Smart AI Router (v4.0)** engineered for **Gemini 4 Hydrogen**. Pairs zero-token structural audits, read-budget simulation (`maxReads: 4096`), safe edge compaction (`edge-compactor.mjs`), 5-layer semantic alias merging and bi-temporal linking (`semantic-planner.mjs`), Cold Graveyard archival/restore (`~/.agentmemory/graveyard.jsonl`), and `iii-engine` RAM/log healing with a mandatory `--verify-json [--strict]` verification gate — while preserving `--beautify` and `--auto` zero-token fallback compatibility.

---

## ✨ Key Features (v4.0)

1. **Mandatory Verification Gate (`--verify-json [--strict]`)**:
   - Runs non-destructive invariant checks across `queryGraph`, `/agentmemory/graph/index`, `/agentmemory/graph/stats`, `performGraphAudit`, and `maintenance.lock`.
   - Outputs structured JSON (`status: "verified" | "failed"`, `version: "4.0"`, `invariants`, `checks`) and exits `0` iff `unlinkedCount === 0 && globalDeg0Count === 0 && incompleteRecords === 0 && auditReducible === 0 && (!strict || !truncated)`.
2. **Read-Budget Simulator & Safe Edge Compaction (`--simulate-budget` & `--compact-edges`)**:
   - Models the `GraphIndexReader` `maxReads: 4096` (`8MB`) read cost across top-500 `pageNodes`, surfaces `hotHubs` and live `truncated` status, and safely compacts low-weight heuristic `related_to` (`weight <= 0.45`) hub edges into `graveyard.jsonl` (dry-run by default; pass `--apply` to execute).
   - Strictly enforces `minDegree >= 2` so compaction never orphans nodes and preserves strong semantic edges (`fixes`, `depends_on`, `imports`, `modifies`, `uses`, or `weight >= 0.8`).
3. **Semantic Synonym Planning & Bi-Temporal Graph (`--suggest-merges`, `--merge-plan`, `--suggest-links`, `--apply-temporal`)**:
   - `--suggest-merges` scores structural/lexical synonym pairs at 0 LLM tokens (`scoreSynonymPair`); `--merge-plan` executes Hydrogen-approved merges across all 5 KV layers while bounding `node.aliases <= 10` and `sourceObservationIds <= 24` under `MAX_POSTINGS=192`.
   - `--suggest-links` bundles unlinked and low-degree `related_to`-only nodes with `mem:obs:*` observation excerpts and domain hubs; `--apply-temporal` persists rich typed relations (`implements`, `configures`, `replaces`, `caused_by`, `optimizes`, `fixes`, `depends_on`, `supersedes`, etc.) plus bi-temporal fields (`tvalid`, `tvalidEnd`, `isLatest`, `supersededBy`).
4. **Task-Aware Smart AI Router v4.0 (`router/smart-router.mjs`)**:
   - Routes `<observation>` / `any` requests through a fast, high-quota chain (`gemini-3.1-flash-lite-preview`, `gemini-flash-lite-latest`, `openai/gpt-oss-20b`, ...) and `<summary>` / `<entities>` / `graph` requests through an accuracy-first chain (`gemini-3.8-flash`, `gemini-flash-latest`, `openai/gpt-oss-120b`, `gemma-4-26b-a4b-it`, ...) before falling back to local Z Fold 3 targets and a zero-fail Local Extractive Fallback.
   - Sanitizes `<observation>` and `<summary>` XML tags (`sanitizeObservationOrSummaryXml`), handles self-closing and body `<entity>`/`<relationship>` tags, extracts real files/concepts in local fallback without hardcoded `.env` edges, and exposes `GET /` `chains: { fast, accuracy }`.
5. **Maintenance Lock, Audit, 5-Layer Dedup & Cold Graveyard (`--lock`, `--unlock`, `--audit`, `--dedup`, `--rename`, `--prune`, `--restore`, `--delete`)**:
   - `--lock` / `--unlock` freezes background LLM graph extraction via `~/.agentmemory/maintenance.lock` (`0ms`, `0` tokens); auto-locks during `--beautify` and `--optimize-ram`.
   - `--audit` catches XML-entity clones, Sentry-style error groups, Unicode hyphen `‑` (`\u2010-\u2015\u2212\u00ad`) variants, unmapped CJK/off-domain hallucinations, and transient scratch noise in `<400ms` at 0 token cost.
   - Protects critical knowledge (`decision`, `preference`, `pattern`, `person`, `project`, `milestone`, `song`, `fixes`-linked `error` nodes, anchors, `degree >= 4` hubs) via an Immunity Whitelist while archiving pruned/merged/deleted records to `~/.agentmemory/graveyard.jsonl` for lossless `--restore`.
6. **Session Stability, RAM Optimization & 0-Token Log Healing (`--optimize-ram`, `--heal`, `--logs`)**:
   - Configures `MAX_OBS_PER_SESSION=0` (unlimited per-session observations to prevent dead letters) and `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500`, patches `parseAttrs(raw)` XML decoding, adds the `event::session::stopped` watermark (`graph_wm:<sessionId>`), guards `extractGraphHeuristics` / `mem::graph-extract` against scratch noise & degree-0 orphans, and inspects `mcp-crash.log` / daemon logs via a byte-offset cursor (`~/.agentmemory/.log-heal-cursor.json`).

---

## 📂 Repository Structure

```text
agentmemory-graph-linker/
├── LICENSE                                        # MIT License
├── README.md                                      # English Documentation (Default)
├── README-VN.md                                   # Vietnamese Documentation (Tiếng Việt)
├── install.sh                                     # Automated v4.0 installer & system patcher
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Gemini 4 Hydrogen Hybrid Neuro-Symbolic skill (v4.0)
│       ├── REFERENCE.md                           # Budget math, 5-layer KV, semantic/temporal design & changelog
│       └── scripts/
│           ├── graph-linker.mjs                   # Executable CLI & verification gate (v4.0)
│           ├── edge-compactor.mjs                 # Read-budget simulator & safe edge compactor
│           └── semantic-planner.mjs               # Synonym scoring, alias merging & bi-temporal links
├── router/
│   ├── smart-router.mjs                           # Task-Aware Smart AI Router v4.0 (reads ~/.agentmemory/.env)
│   └── com.agentmemory.smartrouter.plist.example  # macOS LaunchAgent template
└── tests/
    ├── edge-compactor.test.mjs                    # node:test suite for budget math & safe compaction
    ├── graph-linker.test.mjs                      # node:test suite for normalization, dedup & CLI help
    ├── semantic-planner.test.mjs                  # node:test suite for synonym scoring & bounded merges
    └── smart-router.test.mjs                      # node:test suite for tiering, sanitization & fallbacks
```

---

## 🚀 Quick Install (One Command)

```bash
git clone https://github.com/VisionCrizzal/agentmemory-graph-linker.git
cd agentmemory-graph-linker
bash install.sh
```

---

## 🛠️ Usage

```bash
SCRIPT=~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs

# 1. Inspect graph status & baseline invariants
node "$SCRIPT" --status
node "$SCRIPT" --verify-json [--strict]

# 2. Zero-token candidate extraction & read-budget simulation
node "$SCRIPT" --audit [--days 14]
node "$SCRIPT" --simulate-budget [--limit N] [--target-reads N] [--query-limit N]
node "$SCRIPT" --suggest-merges [--limit N] [--min-score S] [--same-type-only]
node "$SCRIPT" --suggest-links [--limit N]

# 3. Safe symbolic execution (5-layer KV + Cold Graveyard)
node "$SCRIPT" --lock "Manual refactoring"
node "$SCRIPT" --dedup
node "$SCRIPT" --merge-plan '<json_or_file>' [--dry-run]
node "$SCRIPT" --prune [--days 14] [--include-stale] [--include-hallucinations] [--no-hallucinations]
node "$SCRIPT" --apply-temporal '<json_or_file>' [--dry-run]
node "$SCRIPT" --compact-edges [--apply] [--target-reads N] [--limit N] [--query-limit N]
node "$SCRIPT" --unlock

# 4. In-place rename, lossless Cold Graveyard restore & explicit delete
node "$SCRIPT" --rename "Old Name or gn_id" "New Clean Name" [--type <new_type>]
node "$SCRIPT" --restore --list
node "$SCRIPT" --restore --last
node "$SCRIPT" --restore "Node Name or gn_id"
node "$SCRIPT" --delete "Node Name 1" "gn_id_2"

# 5. Zero-token linking fallback, RAM optimization & health/log recovery
node "$SCRIPT" --beautify
node "$SCRIPT" --auto
node "$SCRIPT" --dump
node "$SCRIPT" --apply /path/to/links.json
node "$SCRIPT" --optimize-ram
node "$SCRIPT" --heal                              # alias: --drain
node "$SCRIPT" --logs [--reset-cursor]
node "$SCRIPT" --help                              # or -h

# 6. Mandatory final verification gate
node "$SCRIPT" --verify-json --strict
```

---

## 📋 Changelog

- **v4.0 (2026-11-13)**:
  - **Hybrid Neuro-Symbolic Upgrade (Gemini 4 Hydrogen)**: Added `edge-compactor.mjs` (`--simulate-budget`, `--compact-edges [--apply]`), `semantic-planner.mjs` (`--suggest-merges`, `--merge-plan`, `--suggest-links`, `--apply-temporal`), and `--verify-json [--strict]`.
  - **Task-Aware Smart AI Router v4.0**: Added `FAST_MODEL_ORDER` vs `ACCURACY_MODEL_ORDER` (`selectTargetsForFormat`), added `gemini-flash-latest`, cleaned `<observation>` `buildLocalExtractiveFallback` (removed hardcoded `.env` edges), expanded `sanitizeGraphXmlOutput` for body tags, and added entrypoint guards + `tests/*.test.mjs`.
- **v3.2 (2026-11-09)**:
  - Tuned `MAX_OBS_PER_SESSION=0` (no per-session cap) to eliminate dead-letter drops, preserved `song` & Hi-Res audio nodes, added the `event::session::stopped` watermark (`graph_wm:<sessionId>`), `extractGraphHeuristics` noise/orphan guards, `<observation>`/`<summary>` XML sanitization, and Unicode hyphen `‑` normalization (`normalizeSoftHyphens`).
- **v3.1 (2026-11-08)**:
  - Added Maintenance Lock Mode (`--lock` & `--unlock`) and the CJK & off-domain hallucination gate.
- **v3.0 (2026-11-07)**:
  - Added `--audit`, Sentry-style `--dedup`, 5-layer `--rename`, Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) with `--prune` / `--restore`, `--optimize-ram`, and `parseAttrs` XML entity self-patching.
- **v2.2 (2026-11-05)**:
  - Added Zero-Token Incremental Log Inspector (`--logs` & `--heal`, #1662 / #1674), Smart AI Router Truncated Reply Failover (#1495) & Surrogate-Safe Slicing (#1598), and 5-layer `--delete` with Facet cleanup (#1642).
- **v2.1 (2026-11-05)**:
  - Added `maxReads: 4096` (`8MB`) auto-patching and automatic paused graph index resumption.
- **v2.0 (2026-11-05)**:
  - Added `--delete`, `--heal` / `--drain`, Auto-Anchor Visibility Protection (`pageNodes[0..24]`), Same-Name Entity Collision Batching, and Multi-Pass Boundary Sweep.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE) - see the [LICENSE](./LICENSE) file for details.
