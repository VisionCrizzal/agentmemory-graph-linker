# AgentMemory Knowledge Graph Linker, Cleaner & Smart AI Router (v2.1)

🌐 **Language / Ngôn ngữ:** [🇬🇧 English](./README.md) | **🇻🇳 Tiếng Việt**

Bộ công cụ và **Antigravity Skill (`agentmemory-graph-linker`)** giúp tự động nối các node rời rạc (`UNLINKED / NO RELATIONS YET`), xóa vĩnh viễn các node rác trên cả 4 tầng lưu trữ KV, xả hàng đợi offline spool, và phân bổ đồ thị tri thức của `@agentmemory/agentmemory` (`http://localhost:3113/#graph`) chỉ với **1 lệnh duy nhất, tốn 0 token LLM ngoài**.

---

## ✨ Tính năng nổi bật (v2.1)

1. **Zero-Token Direct Graph Linking (`DIRECT_GRAPH_XML`)**:
   - Nối toàn bộ các node `UNLINKED` vào đồ thị tri thức trong `< 2 giây` mà **không tốn quota của các mô hình lớn**.
   - Hỗ trợ chính xác 100% mọi loại node (`concept`, `file` có hoặc không có phần mở rộng, `command`, `library`, `person`, `error`, `decision`, `function`, `pattern`, `entity`).
   - **Tự động tách Batch chống đụng độ trùng tên**: Tự động tách batch XML khi có 2 thực thể trùng tên nhưng khác kiểu (ví dụ `Zalo` kiểu `entity` và `Zalo` kiểu `library`).
2. **Xóa vĩnh viễn Node & Cạnh trên 4 tầng KV (`--delete`)**:
   - Kết nối trực tiếp vào `iii` engine WebSocket (`ws://127.0.0.1:49134`, namespace `agentmemory-3111`) để xóa sạch hoàn toàn node và các cạnh liên đới trên cả 4 tầng:
     1. `mem:graph:retrieval-data` (tháo mắt xích danh sách liên kết kép và đặt `row: null`)
     2. `mem:graph:retrieval-control` (giảm bộ đếm node/edge và tăng `revision`)
     3. `mem:graph:nodes`, `mem:graph:edges`, `mem:graph:node-degree`
     4. `mem:graph:name-index`, `mem:graph:edge-key` và tự động rebuild `mem:graph:snapshot`
3. **Tự chữa lành (`Self-Healing`) & Xả hàng đợi Spool 1 chạm (`--heal` / `--drain`)**:
   - **Tự động vá lại `maxReads: 4096` (`8MB`)**: Phát hiện khi `dist/index.mjs` bị ghi đè về `maxReads: 2048` sau khi nâng cấp npm và tự động patch lại `4096`.
   - **Tự động bảo toàn `AGENTMEMORY_LLM_PROVIDER=openai`**: Đảm bảo `~/.agentmemory/.env` luôn tương thích với Breaking Change của `@agentmemory/agentmemory` v0.9.32+.
   - **Tự động Resume Graph Index**: Tự động gọi `POST /agentmemory/graph/index/resume` nếu chỉ mục đồ thị bị `paused` khi khởi động lại daemon, xả hàng đợi offline capture spool (`/agentmemory/capture/drain`) và làm mới snapshot.
4. **Thuật toán Neo Đầu Hàng Đợi (`Front-of-Queue LIFO Anchors`) & Chống đứt chuỗi sâu**:
   - Tối ưu theo cấu trúc danh sách liên kết LIFO của AgentMemory, đảm bảo các cạnh mới luôn gắn vào `pageNodes[0..24]` trong ngân sách `maxReads: 4096`.
   - Trong chế độ `--apply`, các chuỗi liên kết sâu (`idx >= 25`) tự động được bắc cầu phụ về `pageNodes[0..24]` để hiển thị 100% ngay trong 1 lượt chạy.
5. **Smart AI Router 11 Tầng (`router/smart-router.mjs`)**:
   - Tự động điều phối qua chuỗi Groq (`gpt-oss-20b`, `qwen3.8-27b`, `gpt-oss-120b`) $\rightarrow$ Google Gemma 4 (`26B MoE`, `31B IT`) $\rightarrow$ Gemini (`3.8 Flash`, `3.5 Flash`, `Flash Lite`) $\rightarrow$ Local AI Node $\rightarrow$ **Local Extractive Fallback (Zero-Fail Safety Net)**.

---

## 📂 Cấu trúc thư mục

```text
agentmemory-graph-linker/
├── README.md                                      # Tài liệu hướng dẫn tiếng Anh (Mặc định)
├── README-VN.md                                   # Tài liệu hướng dẫn tiếng Việt
├── install.sh                                     # Script cài đặt tự động 1 lệnh & vá maxReads: 4096
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill cho Antigravity
│       ├── REFERENCE.md                           # Giải thích toán học maxReads 4096, xóa 4 tầng KV & changelog
│       └── scripts/
│           └── graph-linker.mjs                   # CLI thực thi (--status, --beautify, --delete, --heal, --dump, --apply, --auto)
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

### 1. Chạy trực tiếp trên Terminal

```bash
# Kiểm tra trạng thái đồ thị & số lượng node unlinked
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# Làm đẹp & phân bổ đều đồ thị thành 6 cụm chòm sao chủ đề + quét biên tự động (Khuyên dùng)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# Xóa vĩnh viễn các node rác & cạnh liên đới trên cả 4 tầng KV
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Tên Node 1" "gn_id_2"

# Bảo trì 1 chạm: xả hàng đợi capture spool + kiểm tra index + rebuild snapshot
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

# Xuất danh sách front anchors (0..24) & node unlinked dạng JSON để phân loại ngữ nghĩa
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dump

# Áp dụng danh sách liên kết tùy chỉnh (nhận chuỗi JSON hoặc đường dẫn file JSON)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --apply /duong/dan/links.json

# Tự động nối nhanh toàn bộ node unlinked & rebuild snapshot (0 token)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --auto
```

### 2. Cấu hình API Key cho Smart Router (trong `~/.agentmemory/.env`)

Tương thích chuẩn với `@agentmemory/agentmemory` v0.9.32+ (yêu cầu khai báo tường minh `AGENTMEMORY_LLM_PROVIDER`):

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

## 📋 Changelog (Lịch sử phiên bản)

- **v2.1 (2026-11-05)**:
  - Bổ sung cơ chế tự chữa lành (`selfPatches`) trong `--heal` và `install.sh`: tự động patch lại `maxReads: 4096` (`maxBytes: 8MB`) trong `dist/index.mjs` sau mỗi lần nâng cấp npm và tự động thêm `AGENTMEMORY_LLM_PROVIDER=openai` vào `~/.agentmemory/.env` cho `@agentmemory/agentmemory` v0.9.32+.
  - Bổ sung tự động khôi phục chỉ mục đồ thị (`POST /agentmemory/graph/index/resume`) trong `--heal` khi trạng thái index bị `paused` sau lúc khởi động lại daemon.
- **v2.0 (2026-11-05)**:
  - Thêm chế độ `--delete "<tên_hoặc_id>"` xóa vĩnh viễn node và cạnh liên đới trên cả 4 tầng KV qua `iii` WebSocket (`ws://127.0.0.1:49134`).
  - Thêm chế độ `--heal` / `--drain` xả hàng đợi capture spool và kiểm tra sức khỏe chỉ mục.
  - Bổ sung Auto-Anchor Visibility Protection (`pageNodes[0..24]`) và Same-Name Entity Collision Batching trong `--apply`.
  - Bổ sung Multi-Pass Boundary Sweep trong `--beautify`.

