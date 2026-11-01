# AgentMemory Knowledge Graph Linker & Smart AI Router

🌐 **Language / Ngôn ngữ:** **🇬🇧 English** | [🇻🇳 Tiếng Việt](./README-VN.md)

A lightweight **Antigravity Skill (`agentmemory-graph-linker`)** and **11-Tier Smart AI Router** that automatically links isolated (`UNLINKED / NO RELATIONS YET`) nodes in the `@agentmemory/agentmemory` Knowledge Graph (`http://localhost:3113/#graph`) in **a single command with zero external LLM token usage**—purpose-built so lightweight models like **Gemini 3.8 Flash High** can maintain dense knowledge graphs without burning frontier model credits.

---

## ✨ Key Features

1. **Zero-Token Direct Graph Linking (`DIRECT_GRAPH_XML`)**:
   - Connects all `UNLINKED` nodes in `< 2 seconds` with **zero cloud LLM calls** (saving expensive frontier model quotas like 4 Argon / Claude).
   - Preserves **100% of node types verbatim** (`concept`, `file` with or without file extensions, `command`, `library`, `person`, `error`, `decision`, `function`), avoiding the type-remapping limitations of `import-graphify`.
2. **Front-of-Queue LIFO Anchor Algorithm**:
   - Engineered around AgentMemory's doubly-linked LIFO `"nodes"` and `"adjacency"` posting lists so newly created edges are always placed at `root.head` of `pageNodes[0..9]` and read first.
3. **`maxReads: 4096` KV Read Budget Unlocker**:
   - Upgrades `queryGraphIndex` from the default `maxReads: 2048` cap (which consumes `1,001` KV reads just to load 500 nodes, leaving room for at most `~482` edges—mathematically `< 499` minimum edges required to connect 500 vertices!) to `maxReads: 4096` (the maximum supported by `GraphIndexReader`).
   - Resolves the `"Sparse graph"` warning on `http://localhost:3113/#graph` and renders `1,000+` visible edges in the 500-node view.
4. **11-Tier Fault-Tolerant Smart AI Router (`router/smart-router.mjs`)**:
   - Routes background AgentMemory compression and summarization across Groq (`gpt-oss-20b`, `qwen3.8-27b`, `gpt-oss-120b`) $\rightarrow$ Google Gemma 4 (`26B MoE`, `31B IT`) $\rightarrow$ Gemini (`3.8 Flash`, `3.5 Flash`, `Flash Lite`) $\rightarrow$ Local Edge AI Node (USB / Wi-Fi) $\rightarrow$ **Zero-Fail Local Extractive Fallback**.
   - Includes smart per-target cooldown memory (`0ms skip` on HTTP `429` or offline endpoints), universal `12,000`-character prompt compaction, and automatic bare-`&` XML entity escaping.

---

## 📂 Repository Structure

```text
agentmemory-graph-linker/
├── README.md                                      # English Documentation (Default)
├── README-VN.md                                   # Vietnamese Documentation (Tiếng Việt)
├── install.sh                                     # One-command automated installer
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill instructions for Antigravity / Gemini 3.8 Flash High
│       ├── REFERENCE.md                           # Deep-dive on maxReads: 4096 math & LIFO posting lists
│       └── scripts/
│           └── graph-linker.mjs                   # Executable CLI (--status, --auto, --dump, --apply)
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

### 1. Run via CLI or Gemini 3.8 Flash High

```bash
# Check Knowledge Graph status & unlinked node count in the 500-node slice
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# Beautify & Balance Layout into 6 Thematic Constellations (Recommended)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# Auto-link all unlinked nodes & rebuild graph snapshot (0 external LLM tokens)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto

# Dump front anchors & unlinked nodes as compact JSON for AI semantic curation
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump

# Apply custom AI-curated semantic relations
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply '[{"source":"Node A","target":"Node B","type":"uses"}]'
```

### 2. Configure API Keys for Smart Router (`~/.agentmemory/.env`)

The Smart Router automatically loads keys from `~/.agentmemory/.env` (zero hardcoded secrets in source code):

```dotenv
OPENAI_API_KEY=smart-router
OPENAI_BASE_URL=http://127.0.0.1:3118/v1
OPENAI_MODEL=smart-router

GROQ_API_KEY=gsk_your_groq_key_here
GEMINI_API_KEY=your_gemini_key_here
SUMMARIZE_CHUNK_SIZE=5000
SUMMARIZE_CHUNK_CONCURRENCY=1
```
