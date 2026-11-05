# AgentMemory Knowledge Graph Linker, Cleaner & Smart AI Router (v2.2)

🌐 **Language / Ngôn ngữ:** **🇬🇧 English** | [🇻🇳 Tiếng Việt](./README-VN.md)

A lightweight **Antigravity Skill (`agentmemory-graph-linker`)** and **11-Tier Smart AI Router** that links isolated (`UNLINKED / NO RELATIONS YET`) nodes, permanently deletes unwanted nodes across all 5 KV storage layers (including `mem:facets`), drains offline capture spools, incrementally inspects & heals `mcp-crash.log` and daemon logs with a **0-token byte-offset cursor**, and balances thematic clusters in the `@agentmemory/agentmemory` Knowledge Graph (`http://localhost:3113/#graph`).

---

## ✨ Key Features (v2.2)

1. **Zero-Token Incremental Log Inspector & Self-Healer (`--logs` & `--heal`, #1662 / #1674)**:
   - Connects directly to `~/.agentmemory/mcp-crash.log` (and rotated `mcp-crash.log.1` / `$TMPDIR/agentmemory-mcp-crash.log`), `~/Library/Logs/agentmemory.error.log`, and `~/Library/Logs/agentmemory.log`.
   - Tracks `{ ino, offset, mtimeMs }` in `~/.agentmemory/.log-heal-cursor.json` so **files and log lines that have already been read and fixed are never read again** (`unreadBytesRead: 0`, `status: "skipped_already_read"`), saving 100% of tokens on subsequent checks.
2. **Smart AI Router v2.2 with Truncated Reply Failover (#1495) & Surrogate-Safe Slicing (#1598)**:
   - **Truncated Reply Failover (#1495)**: Detects `finish_reason === "length"` (`max_tokens` hit) as well as unclosed `<summary>`, `<observation>`, or `<entities>` XML tags, automatically placing the truncated upstream tier on a 15s cooldown and failing over to the next tier in the 11-tier chain instead of storing incomplete memories.
   - **Surrogate-Safe UTF-16 Truncation (#1598)**: `sliceHeadSurrogateSafe()` and `sliceTailSurrogateSafe()` ensure prompt compaction (`12,000` chars) and fallback synthesis never split UTF-16 surrogate pairs (emojis, CJK, mathematical symbols).
3. **5-Layer Permanent Node, Edge & Facet Deletion (`--delete`, #1642)**:
   - Connects directly to the `iii` engine WebSocket (`ws://127.0.0.1:49134`, namespace `agentmemory-3111`) to permanently remove unwanted nodes, incident edges, and orphaned facets across all 5 storage layers:
     1. `mem:graph:retrieval-data` (unlinks doubly-linked postings and clears `row: null`)
     2. `mem:graph:retrieval-control` (decrements node/edge counters and bumps `revision`)
     3. `mem:graph:nodes`, `mem:graph:edges`, `mem:graph:node-degree`, `mem:graph:membership`, `mem:graph:edge-history`
     4. `mem:graph:name-index`, `mem:graph:edge-key`, and rebuilds `mem:graph:snapshot`
     5. `mem:facets` (purges orphaned facets referencing deleted nodes or edges, #1642)
4. **One-Shot Self-Healing, Session Sweep & Resource Recovery (`--heal` / `--drain`)**:
   - **Self-Patches `maxReads: 4096` (`8MB`) & `AGENTMEMORY_LLM_PROVIDER=openai`**: Automatically restores `maxReads: 4096` after npm upgrades, ensures `AGENTMEMORY_LLM_PROVIDER=openai` in `~/.agentmemory/.env`, and removes deprecated `OPENAI_API_KEY_FOR_LLM` (#1664).
   - **Abandoned Session Sweep (#1645), Orphaned Index Generation Check (#1256) & Bounded Graph Stats (#1260)**: Triggers `mem::session-sweep` for stale active sessions, checks `mem:idx:bm25` `"legacy:sweep"`, queries `mem::graph-stats`, drains the capture spool (`/agentmemory/capture/drain`), auto-resumes paused graph indexes, and rebuilds the snapshot.
5. **Zero-Token Direct Graph Linking (`DIRECT_GRAPH_XML`) & Front-of-Queue LIFO Anchors**:
   - Connects all `UNLINKED` nodes in `< 2 seconds` with **zero cloud LLM calls**, preserving 100% of node types verbatim and automatically splitting same-name entities with different types into non-colliding XML batches.

---

## 📂 Repository Structure

```text
agentmemory-graph-linker/
├── README.md                                      # English Documentation (Default)
├── README-VN.md                                   # Vietnamese Documentation (Tiếng Việt)
├── install.sh                                     # One-command automated installer & maxReads patcher
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill instructions for Antigravity (v2.2)
│       ├── REFERENCE.md                           # Deep-dive on maxReads: 4096, 5-layer KV delete, log cursor & changelog
│       └── scripts/
│           └── graph-linker.mjs                   # Executable CLI (--status, --beautify, --delete, --heal, --logs, --dump, --apply, --auto)
└── router/
    ├── smart-router.mjs                           # 11-tier Smart AI Router v2.2 (reads keys from ~/.agentmemory/.env)
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

### 1. Run via CLI

```bash
# Check Knowledge Graph status & unlinked node count in the 500-node slice
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# Beautify & Balance Layout into 6 Thematic Constellations + Multi-Pass Sweep (Recommended)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# Permanently delete unwanted nodes, incident edges & facets across all 5 KV layers
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Node Name 1" "gn_id_2"

# One-shot health recovery: delta log heal + drain spool + session sweep + verify index + rebuild snapshot
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

# Inspect & heal ONLY unread bytes from mcp-crash.log & daemon logs (0 tokens on unchanged files)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --logs

# Dump front anchors (0..24) & unlinked nodes as compact JSON for AI semantic curation
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump

# Apply custom semantic relations (accepts inline JSON or file path)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply /path/to/links.json

# Fast auto-link all unlinked nodes & rebuild graph snapshot (0 external LLM tokens)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto
```

### 2. Configure API Keys for Smart Router (`~/.agentmemory/.env`)

Compatible with `@agentmemory/agentmemory` v0.9.32+ (which requires explicit `AGENTMEMORY_LLM_PROVIDER`):

```dotenv
AGENTMEMORY_LLM_PROVIDER=openai
OPENAI_API_KEY=smart-router
OPENAI_BASE_URL=http://127.0.0.1:3118/v1
OPENAI_MODEL=smart-router

GROQ_API_KEY=gsk_your_groq_key_here
GEMINI_API_KEY=your_gemini_key_here
FALLBACK_PROVIDERS=gemini
SUMMARIZE_CHUNK_SIZE=5000
SUMMARIZE_CHUNK_CONCURRENCY=1
```

---

## 📋 Changelog

- **v2.2 (2026-11-05)**:
  - **Zero-Token Incremental Log Inspector (`--logs` & integrated in `--heal`, #1662 / #1674)**: Connects to `~/.agentmemory/mcp-crash.log` (and `.1` / `$TMPDIR` fallback) plus daemon logs (`agentmemory.error.log`, `agentmemory.log`) using a persistent byte-offset & inode cursor (`~/.agentmemory/.log-heal-cursor.json`) so already-read and already-fixed log entries are skipped with `0 bytes` read.
  - **Smart AI Router v2.2 (`router/smart-router.mjs`)**: Added **Truncated Reply Failover (#1495)** (`finish_reason === "length"` and unclosed `<summary>`/`<observation>`/`<entities>` XML detection) and **Surrogate-Safe UTF-16 Slicing (#1598)** (`sliceHeadSurrogateSafe`, `sliceTailSurrogateSafe`).
  - **5-Layer `--delete` with Facet & Membership Cleanup (#1642)**: Purges orphaned `mem:facets`, `mem:graph:membership`, and `mem:graph:edge-history` entries when deleting nodes.
  - **Enhanced `--heal` Resource Maintenance (#1256, #1260, #1645, #1664)**: Triggers `mem::session-sweep`, checks `mem:idx:bm25` `"legacy:sweep"`, queries bounded `mem::graph-stats`, and strips deprecated `OPENAI_API_KEY_FOR_LLM`.
- **v2.1 (2026-11-05)**:
  - Added self-healing in `--heal` and `install.sh` to automatically re-patch `maxReads: 4096` (`maxBytes: 8MB`) in `dist/index.mjs` after npm upgrades and ensure `AGENTMEMORY_LLM_PROVIDER=openai` in `~/.agentmemory/.env`.
  - Added automatic `POST /agentmemory/graph/index/resume` recovery in `--heal` when the retrieval index is `paused` after a daemon restart.
- **v2.0 (2026-11-05)**:
  - Added `--delete "<name_or_id>"`, `--heal` / `--drain`, Auto-Anchor Visibility Protection (`pageNodes[0..24]`), Same-Name Entity Collision Batching, and Multi-Pass Boundary Sweep.
