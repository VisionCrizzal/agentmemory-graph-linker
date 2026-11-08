# AgentMemory Knowledge Graph Linker, Deduplicator, Cleaner & Smart AI Router (v3.1)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Companion for AgentMemory](https://img.shields.io/badge/Companion%20For-rohitg00%2Fagentmemory-blue.svg)](https://github.com/rohitg00/agentmemory)

🌐 **Language / Ngôn ngữ:** **🇬🇧 English** | [🇻🇳 Tiếng Việt](./README-VN.md)

> [!IMPORTANT]
> **Prerequisite / Ecosystem Requirement:**
> This toolkit is an essential companion skill specifically designed for **[AgentMemory (`rohitg00/agentmemory`)](https://github.com/rohitg00/agentmemory)**.
> It operates directly with the `@agentmemory/agentmemory` daemon, `iii-sdk` WebSocket (`ws://127.0.0.1:49134`), and Knowledge Graph endpoints (`http://localhost:3113/#graph`). You must have [AgentMemory](https://github.com/rohitg00/agentmemory) installed and running to use this skill.

A lightweight **Antigravity Skill (`agentmemory-graph-linker`)** and **11-Tier Smart AI Router (v3.1)** that links isolated (`UNLINKED / NO RELATIONS YET`) nodes, freezes background LLM graph pollution via **Maintenance Lock** (`--lock`/`--unlock`), audits & filters free-LLM & unmapped CJK hallucinations at **0 token cost**, merges duplicate error & entity nodes across all 5 KV storage layers, renames nodes atomically in-place, safely archives transient scratch noise to a lossless **Cold Graveyard (`~/.agentmemory/graveyard.jsonl`)** with `--restore`, optimizes `iii-engine` RAM footprint, incrementally inspects & heals `mcp-crash.log` and daemon logs with a **0-token byte-offset cursor**, and balances thematic clusters in the [AgentMemory](https://github.com/rohitg00/agentmemory) Knowledge Graph (`http://localhost:3113/#graph`).

---

## ✨ Key Features (v3.1)

1. **Maintenance Lock Mode (`--lock` & `--unlock`)**:
   - Creates a temporary lock flag (`~/.agentmemory/maintenance.lock`). When active, `smart-router.mjs` immediately short-circuits background LLM graph extraction requests with empty XML tags (`<entities></entities><relationships></relationships>`) at **0ms latency and 0 tokens**. Auto-locks during `--beautify` and `--optimize-ram` to prevent background LLMs from polluting the graph during maintenance.
2. **CJK & Off-Domain Foreign Language Gate**:
   - Rejects unmapped CJK characters at the router gate and audit level to prevent foreign language noise from OCR weights or model logs from polluting the knowledge graph, while auto-mapping standard technical terms (e.g. `多Token预测` -> `Multi-Token Prediction (MTP)`, `逆向工程` -> `Reverse Engineering`). Blocks bizarre music/hallucination connections (e.g. `Hollywood Tonight`).
3. **Zero-Token Provenance & Hallucination Audit (`--audit`)**:
   - Cross-references graph nodes against your entire local observation, memory, and summary corpus (`mem:obs:*`, `mem:memories`, `mem:summaries`) plus a Tech Lexicon and off-domain hallucination detector in `< 400ms` over WebSocket.
   - Catches free-LLM hallucinations, XML entity corruption (`&amp;quot;`), duplicate error clusters, and ephemeral scratch files with **0 API calls and 0 LLM tokens**.
4. **Sentry-Style Error Deduplication & 5-Layer Atomic Merge/Rename (`--dedup` & `--rename`)**:
   - Collapses repetitive error nodes (e.g. multiple `ProcessException: exit code 72 ... xcodebuild` variants), case-insensitive duplicates (`Flutter` vs `flutter`), and XML-escaped clones (`GlobalKey&amp;lt;FormState&amp;gt;`) into a single **Canonical Node**, re-pointing all incident edges across all 5 KV layers and tracking `properties.occurrences`.
   - `--rename "<old>" "<new>" [--type <type>]` renames any node in-place across `mem:graph:nodes`, `mem:graph:name-index`, and `mem:graph:retrieval-data` (or automatically merges if the target name already exists).
   - Self-patches `parseAttrs(raw)` in AgentMemory's `dist/*.mjs` so XML entities (`&quot;`, `&lt;`, `&gt;`, `&amp;`) are decoded natively and never create phantom `&amp;quot;` nodes again.
5. **Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) & Immunity Whitelist (`--prune` & `--restore`)**:
   - **Immunity Whitelist ("Kim Bài Miễn Tử")**: Automatically protects `decision`, `preference`, `pattern`, `person`, `project`, `milestone`, any `error` node with a `fixes` edge, thematic anchors, and `degree >= 4` hubs from pruning.
   - **Lossless Cold Storage**: Before `--prune`, `--dedup`, or `--delete` removes any node from the 5 KV layers, the full node + incident edges + facets are saved to `~/.agentmemory/graveyard.jsonl`. Restore any node at any time with `--restore "<name_or_id>"` (or `--restore --last`).
6. **Real `iii-engine` RAM Optimization (`--optimize-ram`)**:
   - Targets the Rust `iii-engine` in-memory KV footprint by evicting tens of thousands of redundant doubly-linked posting list records from `mem:graph:retrieval-data` and tuning `MAX_OBS_PER_SESSION=800` & `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500` in `~/.agentmemory/.env`.
7. **Zero-Token Incremental Log Inspector (`--logs` & `--heal`, #1662 / #1674) & Smart AI Router v3.1**:
   - Tracks `{ ino, offset, mtimeMs }` in `~/.agentmemory/.log-heal-cursor.json` so already-read log lines in `mcp-crash.log` and daemon logs are skipped with `0 bytes` read.
   - `smart-router.mjs` v3.1 includes Truncated Reply Failover (#1495), Surrogate-Safe Slicing (#1598), nested XML entity unescaping, and an `<entities>` scratch/hallucination/CJK noise gate.

---

## 📂 Repository Structure

```text
agentmemory-graph-linker/
├── LICENSE                                        # MIT License
├── README.md                                      # English Documentation (Default)
├── README-VN.md                                   # Vietnamese Documentation (Tiếng Việt)
├── install.sh                                     # One-command automated installer & v3.0 patcher
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill instructions for Antigravity (v3.0)
│       ├── REFERENCE.md                           # Deep-dive on 5-layer KV engine, Cold Graveyard, RAM optimization & changelog
│       └── scripts/
│           └── graph-linker.mjs                   # Executable CLI (--status, --audit, --dedup, --rename, --prune, --restore, --optimize-ram, --beautify, --delete, --heal, --logs, --dump, --apply, --auto)
└── router/
    ├── smart-router.mjs                           # 11-tier Smart AI Router v3.0 (reads keys from ~/.agentmemory/.env)
    └── com.agentmemory.smartrouter.plist.example  # macOS LaunchAgent template
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
# 1. Check Knowledge Graph status & unlinked node count in the 500-node slice
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# 2. Dry-Run Audit: inspect duplicate groups, XML-entity corruption, hallucinations & scratch candidates
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --audit

# 3. 5-Layer Atomic Deduplication: merge duplicate error/entity nodes & unescape XML entities
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dedup

# 4. 5-Layer Atomic In-Place Rename (or merge if target name already exists)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --rename "Old Name or gn_id" "New Clean Name"

# 5. Safe Prune transient scratch & hallucination nodes into Cold Graveyard (~/.agentmemory/graveyard.jsonl)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --prune

# 6. List or Restore archived nodes from Cold Graveyard (100% lossless)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --restore --list
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --restore "Node Name or gn_id"

# 7. One-Shot RAM & Store Optimizer (tunes .env + dedups + prunes scratch to graveyard + sweeps sessions)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --optimize-ram

# 8. Beautify & Balance Layout into 6 Thematic Constellations + Multi-Pass Sweep (Recommended)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# 9. Permanently delete specific nodes across all 5 KV layers (backed up to graveyard.jsonl)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Node Name 1" "gn_id_2"

# 10. One-shot health recovery: delta log heal + drain spool + session sweep + verify index + rebuild snapshot
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

# 11. Inspect & heal ONLY unread bytes from mcp-crash.log & daemon logs (0 tokens on unchanged files)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --logs
```

---

## 📋 Changelog

- **v3.0 (2026-11-07)**:
  - **Zero-Token Provenance & Hallucination Audit (`--audit`)**: Cross-checks nodes against the full `mem:obs:*`, `mem:memories`, and `mem:summaries` corpus + Tech Lexicon in `< 400ms` with 0 LLM tokens.
  - **Sentry-Style Error Fingerprinting & 5-Layer Atomic Deduplication (`--dedup`)**: Merges duplicate error nodes, case-insensitive duplicates, and XML-escaped clones across all 5 KV layers while preserving incident edges and tracking `properties.occurrences`.
  - **5-Layer Atomic In-Place Rename (`--rename`)**: Renames or merges nodes across `mem:graph:nodes`, `mem:graph:name-index`, `mem:graph:node-degree`, `mem:graph:retrieval-data`, and `mem:graph:retrieval-control`.
  - **Cold Graveyard (`~/.agentmemory/graveyard.jsonl`) & Lossless `--restore` (`--prune` & `--restore`)**: Protects core nodes with an Immunity Whitelist and archives pruned/deleted nodes and edges to disk for 1-command restoration.
  - **Real `iii-engine` RAM Optimization (`--optimize-ram`) & `parseAttrs` XML Decode Patch**: Tunes `MAX_OBS_PER_SESSION=800` & `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500`, patches `parseAttrs(raw)` in AgentMemory `dist/*.mjs` to decode XML entities natively, and upgrades `smart-router.mjs` to v3.0 with an `<entities>` noise/hallucination gate.
- **v2.2 (2026-11-05)**:
  - Added Zero-Token Incremental Log Inspector (`--logs` & `--heal`, #1662 / #1674), Smart AI Router v2.2 Truncated Reply Failover (#1495) & Surrogate-Safe Slicing (#1598), and 5-Layer `--delete` with Facet Cleanup (#1642).
- **v2.1 (2026-11-05)**:
  - Added self-healing in `--heal` and `install.sh` to automatically re-patch `maxReads: 4096` (`8MB`) and auto-resume paused graph indexes.
- **v2.0 (2026-11-05)**:
  - Added `--delete`, `--heal` / `--drain`, Auto-Anchor Visibility Protection (`pageNodes[0..24]`), Same-Name Entity Collision Batching, and Multi-Pass Boundary Sweep.

---

## 📄 License

This project is licensed under the [MIT License](./LICENSE) - see the [LICENSE](./LICENSE) file for details.
