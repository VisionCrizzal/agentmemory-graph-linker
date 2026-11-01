# AgentMemory Knowledge Graph Linker & Smart AI Router

🌐 **Language / Ngôn ngữ:** [🇬🇧 English](./README.md) | **🇻🇳 Tiếng Việt**

Bộ công cụ và **Antigravity Skill (`agentmemory-graph-linker`)** giúp tự động nối các node rời rạc (`UNLINKED / NO RELATIONS YET`) trong Knowledge Graph của `@agentmemory/agentmemory` (`http://localhost:3113/#graph`) chỉ với **1 lệnh duy nhất, tốn 0 token LLM ngoài**, tối ưu đặc biệt cho các mô hình nhẹ như **Gemini 3.8 Flash High**.

---

## ✨ Tính năng nổi bật

1. **Zero-Token Direct Graph Linking (`DIRECT_GRAPH_XML`)**:
   - Nối toàn bộ các node `UNLINKED` vào đồ thị tri thức trong `< 2 giây` mà **không tốn quota của các mô hình lớn (như 4 Argon / Claude)**.
   - Hỗ trợ chính xác 100% mọi loại node (`concept`, `file` có hoặc không có phần mở rộng, `command`, `library`, `person`, `error`, `decision`, `function`).
2. **Thuật toán Neo Đầu Hàng Đợi (`Front-of-Queue LIFO Anchors`)**:
   - Tối ưu theo cấu trúc danh sách liên kết LIFO (`"nodes"` và `"adjacency"`) của AgentMemory, đảm bảo các cạnh mới luôn nằm ở đầu hàng đợi đọc (`pageNodes[0..9]`).
3. **Mở khóa giới hạn đọc `maxReads: 4096`**:
   - Nâng hạn mức `maxReads` trong `queryGraphIndex` từ `2048` lên mức tối đa `4096` mà `GraphIndexReader` hỗ trợ, giúp hiển thị trọn vẹn `1.000+` cạnh trên khung nhìn 500 node và xóa bỏ cảnh báo `"Sparse graph"`.
4. **Smart AI Router 11 Tầng (`router/smart-router.mjs`)**:
   - Tự động điều phối qua chuỗi Groq (`gpt-oss-20b`, `qwen3.8-27b`, `gpt-oss-120b`) $\rightarrow$ Google Gemma 4 (`26B MoE`, `31B IT`) $\rightarrow$ Gemini (`3.8 Flash`, `3.5 Flash`, `Flash Lite`) $\rightarrow$ Local AI Node (Z Fold 3 USB/Wi-Fi) $\rightarrow$ **Local Extractive Fallback (Zero-Fail Safety Net)**.
   - Tích hợp bộ nhớ Cooldown (`0ms skip` khi gặp HTTP `429`), tự động nén prompt `12.000 chars` và tự sửa lỗi ký tự `&` trần trong XML.

---

## 📂 Cấu trúc thư mục

```text
agentmemory-graph-linker/
├── README.md                                      # Tài liệu hướng dẫn tiếng Anh (Mặc định)
├── README-VN.md                                   # Tài liệu hướng dẫn tiếng Việt
├── install.sh                                     # Script cài đặt tự động 1 lệnh
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill cho Antigravity / Gemini 3.8 Flash High
│       ├── REFERENCE.md                           # Giải thích toán học maxReads 4096 & LIFO posting
│       └── scripts/
│           └── graph-linker.mjs                   # CLI thực thi (--status, --auto, --dump, --apply)
└── router/
    ├── smart-router.mjs                           # Smart AI Router (đọc API key từ ~/.agentmemory/.env)
    └── com.agentmemory.smartrouter.plist.example  # Mẫu LaunchAgent tự chạy ngầm trên macOS
```

---

## 🚀 Cài đặt nhanh (1 lệnh)

```bash
git clone https://github.com/VisionCrizzal/agentmemory-graph-linker.git
cd agentmemory-graph-linker
bash install.sh
```

---

## 🛠️ Cách sử dụng

### 1. Chạy trực tiếp trên Terminal hoặc qua Gemini 3.8 Flash High

```bash
# Kiểm tra trạng thái đồ thị & số lượng node unlinked
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# Tự động nối toàn bộ node unlinked & rebuild snapshot (0 token)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto

# Xuất danh sách node unlinked dạng JSON để AI tự phân loại ngữ nghĩa
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump

# Áp dụng danh sách liên kết tùy chỉnh
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply '[{"source":"Node A","target":"Node B","type":"uses"}]'
```

### 2. Cấu hình API Key cho Smart Router (trong `~/.agentmemory/.env`)

Smart Router tự động đọc khóa từ `~/.agentmemory/.env` (không lưu cứng API key trong code):

```dotenv
OPENAI_API_KEY=smart-router
OPENAI_BASE_URL=http://127.0.0.1:3118/v1
OPENAI_MODEL=smart-router

GROQ_API_KEY=gsk_your_groq_key_here
GEMINI_API_KEY=your_gemini_key_here
SUMMARIZE_CHUNK_SIZE=5000
SUMMARIZE_CHUNK_CONCURRENCY=1
```
