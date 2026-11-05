# AgentMemory Knowledge Graph Linker, Cleaner & Smart AI Router (v2.0)

🌐 **Language / Ngôn ngữ:** **🇬🇧 English** | [🇻🇳 Tiếng Việt](./README-VN.md)

A lightweight **Antigravity Skill (`agentmemory-graph-linker`)** and **11-Tier Smart AI Router** that links isolated (`UNLINKED / NO RELATIONS YET`) nodes, permanently deletes unwanted nodes across all 4 KV storage layers, drains offline capture spools, and balances thematic clusters in the `@agentmemory/agentmemory` Knowledge Graph (`http://localhost:3113/#graph`) in **a single command with zero external LLM token usage**.

---

## ✨ Key Features (v2.0)

1. **Zero-Token Direct Graph Linking (`DIRECT_GRAPH_XML`)**:
   - Connects all `UNLINKED` nodes in `< 2 seconds` with **zero cloud LLM calls** (saving expensive frontier model quotas).
   - Preserves **100% of node types verbatim** (`concept`, `file` with or without file extensions, `command`, `library`, `person`, `error`, `decision`, `function`, `pattern`, `entity`), avoiding the type-remapping limitations of `import-graphify`.
   - **Same-Name Entity Collision Batching (v2.0)**: Automatically splits XML batches when two entities share the same `name` with different `type` (e.g. `Zalo` as `entity` vs `library`) so `parseGraphXml` never overwrites node types.
2. **4-Layer Permanent Node & Edge Deletion (`--delete`)**:
   - Connects directly to the `iii` engine WebSocket (`ws://127.0.0.1:49134`, namespace `agentmemory-3111`) to permanently remove unwanted nodes and their incident edges across all 4 storage layers:
     1. `mem:graph:retrieval-data` (unlinks doubly-linked postings and clears `row: null`)
     2. `mem:graph:retrieval-control` (decrements node/edge counters and bumps `revision`)
     3. `mem:graph:nodes`, `mem:graph:edges`, `mem:graph:node-degree`
     4. `mem:graph:name-index`, `mem:graph:edge-key`, and rebuilds `mem:graph:snapshot`
3. **One-Shot Health Recovery & Spool Drain (`--heal` / `--drain`)**:
   - Flushes pending observations in the offline capture spool (`/agentmemory/capture/drain`), verifies retrieval index status (`/agentmemory/graph/index`), rebuilds the graph snapshot, and checks `unlinkedCount`.
4. **Front-of-Queue LIFO Anchor Algorithm & Auto-Anchor Visibility Protection**:
   - Engineered around AgentMemory's doubly-linked LIFO `"nodes"` and `"adjacency"` posting lists so newly created edges attach to `pageNodes[0..24]` and are guaranteed to be read within the `maxReads: 4096` KV budget.
   - In `--apply`, deep chains (`idx >= 25`) automatically receive a visibility bridge to `pageNodes[0..24]`.
5. **11-Tier Fault-Tolerant Smart AI Router (`router/smart-router.mjs`)**:
   - Routes background AgentMemory compression and summarization across Groq (`gpt-oss-20b`, `qwen3.8-27b`, `gpt-oss-120b`) $\rightarrow$ Google Gemma 4 (`26B MoE`, `31B IT`) $\rightarrow$ Gemini (`3.8 Flash`, `3.5 Flash`, `Flash Lite`) $\rightarrow$ Local Edge AI Node $\rightarrow$ **Zero-Fail Local Extractive Fallback**.

---

## 📂 Repository Structure

```text
agentmemory-graph-linker/
├── README.md                                      # English Documentation (Default)
├── README-VN.md                                   # Vietnamese Documentation (Tiếng Việt)
├── install.sh                                     # One-command automated installer & maxReads patcher
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill instructions for Antigravity
│       ├── REFERENCE.md                           # Deep-dive on maxReads: 4096, 4-layer KV delete & changelog
│       └── scripts/
│           └── graph-linker.mjs                   # Executable CLI (--status, --beautify, --delete, --heal, --dump, --apply, --auto)
└── router/
    ├── smart-router.mjs                           # 11-tier Smart AI Router (reads keys from ~/.agentmemory/.env)
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

# Permanently delete unwanted nodes & incident edges across all 4 KV layers
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Node Name 1" "gn_id_2"

# One-shot health recovery: drain offline capture spool + verify index + rebuild snapshot
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

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
