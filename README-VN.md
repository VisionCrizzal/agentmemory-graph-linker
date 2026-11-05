# AgentMemory Knowledge Graph Linker, Cleaner & Smart AI Router (v2.2)

🌐 **Language / Ngôn ngữ:** [🇬🇧 English](./README.md) | **🇻🇳 Tiếng Việt**

Bộ công cụ và **Antigravity Skill (`agentmemory-graph-linker`)** kèm **Smart AI Router 11 tầng (v2.2)** giúp tự động nối các node rời rạc (`UNLINKED / NO RELATIONS YET`), xóa vĩnh viễn các node rác trên cả 5 tầng lưu trữ KV (bao gồm `mem:facets`), xả hàng đợi offline spool, đọc & tự sửa lỗi từ `mcp-crash.log` / daemon log bằng **con trỏ byte-offset tiết kiệm 100% token cho các dòng đã đọc**, và phân bổ đồ thị tri thức của `@agentmemory/agentmemory` (`http://localhost:3113/#graph`).

---

## ✨ Tính năng nổi bật (v2.2)

1. **Đọc Log Tăng Trưởng & Tự Chữa Lành Không Tốn Token (`--logs` & `--heal`, #1662 / #1674)**:
   - Kết nối trực tiếp vào `~/.agentmemory/mcp-crash.log` (cùng bản xoay vòng `mcp-crash.log.1` và `$TMPDIR/agentmemory-mcp-crash.log`), `~/Library/Logs/agentmemory.error.log` và `~/Library/Logs/agentmemory.log`.
   - Lưu vị trí con trỏ `{ ino, offset, mtimeMs }` tại `~/.agentmemory/.log-heal-cursor.json`: **file nào hoặc đoạn log nào đã đọc và sửa xong sẽ được bỏ qua hoàn toàn (`unreadBytesRead: 0`, `skipped_already_read`)**, tuyệt đối không đọc lại gây tốn token.
2. **Smart AI Router v2.2 Chống Lưu Câu Trả Lời Cụt (#1495) & Cắt Chuỗi An Toàn Surrogate (#1598)**:
   - **Chống lưu câu trả lời cụt (#1495)**: Tự động phát hiện khi model chạm trần `max_tokens` (`finish_reason === "length"`) hoặc trả về thẻ XML `<summary>`, `<observation>`, `<entities>` bị cụt ngang chưa đóng thẻ $\rightarrow$ tự động chuyển tiếp (failover) sang tầng model dự phòng tiếp theo thay vì lưu dữ liệu dở dang vào bộ nhớ.
   - **Cắt chuỗi UTF-16 Surrogate-Safe (#1598)**: Hàm `sliceHeadSurrogateSafe()` và `sliceTailSurrogateSafe()` bảo vệ toàn vẹn ký tự Unicode đặc biệt, emoji và CJK/Tiếng Việt khi rút gọn prompt (`12,000` ký tự).
3. **Xóa Vĩnh Viễn Node, Cạnh & Facet Trên 5 Tầng KV (`--delete`, #1642)**:
   - Kết nối trực tiếp vào `iii` engine WebSocket (`ws://127.0.0.1:49134`, namespace `agentmemory-3111`) để xóa sạch hoàn toàn node, cạnh liên đới và facet mồ côi trên cả 5 tầng:
     1. `mem:graph:retrieval-data` (tháo mắt xích danh sách liên kết kép và đặt `row: null`)
     2. `mem:graph:retrieval-control` (giảm bộ đếm node/edge và tăng `revision`)
     3. `mem:graph:nodes`, `mem:graph:edges`, `mem:graph:node-degree`, `mem:graph:membership`, `mem:graph:edge-history`
     4. `mem:graph:name-index`, `mem:graph:edge-key` và tự động rebuild `mem:graph:snapshot`
     5. `mem:facets` (dọn dẹp toàn bộ Facet mồ côi trỏ tới node/cạnh vừa xóa theo bản vá #1642)
4. **Bảo Trì 1 Chạm, Quét Session Bỏ Rơi & Thu Hồi Index Mồ Côi (`--heal` / `--drain`)**:
   - **Tự động vá `maxReads: 4096` (`8MB`) & `AGENTMEMORY_LLM_PROVIDER=openai`**: Tự động khôi phục `maxReads: 4096` sau khi nâng cấp npm, giữ `AGENTMEMORY_LLM_PROVIDER=openai` và dọn bỏ biến cũ `OPENAI_API_KEY_FOR_LLM` (#1664).
   - **Quét Session bị bỏ rơi (#1645), Kiểm tra Index mồ côi (#1256) & Thống kê đồ thị giới hạn (#1260)**: Tự động kích hoạt `mem::session-sweep`, kiểm tra trạng thái thu hồi thế hệ index mồ côi (`mem:idx:bm25` `"legacy:sweep"`), truy vấn `mem::graph-stats` giới hạn kích thước gói tin, xả hàng đợi capture spool và làm mới snapshot.
5. **Zero-Token Direct Graph Linking (`DIRECT_GRAPH_XML`) & Neo Đầu Hàng Đợi LIFO**:
   - Nối toàn bộ các node `UNLINKED` trong `< 2 giây` tốn 0 token ngoài, bảo toàn 100% kiểu node và tự động tách batch XML khi có thực thể trùng tên khác kiểu.

---

## 📂 Cấu trúc thư mục

```text
agentmemory-graph-linker/
├── README.md                                      # Tài liệu hướng dẫn tiếng Anh (Mặc định)
├── README-VN.md                                   # Tài liệu hướng dẫn tiếng Việt
├── install.sh                                     # Script cài đặt tự động 1 lệnh & vá maxReads: 4096
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill cho Antigravity (v2.2)
│       ├── REFERENCE.md                           # Giải thích toán học maxReads 4096, xóa 5 tầng KV, con trỏ log & changelog
│       └── scripts/
│           └── graph-linker.mjs                   # CLI thực thi (--status, --beautify, --delete, --heal, --logs, --dump, --apply, --auto)
└── router/
    ├── smart-router.mjs                           # Smart AI Router v2.2 (đọc API key từ ~/.agentmemory/.env)
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

# Xóa vĩnh viễn các node rác, cạnh liên đới & facet trên cả 5 tầng KV
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Tên Node 1" "gn_id_2"

# Bảo trì 1 chạm: đọc/sửa log mới + xả spool + quét session bỏ rơi + kiểm tra index + rebuild snapshot
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

# Chỉ đọc phần byte mới phát sinh trong mcp-crash.log & daemon log (0 byte nếu đã đọc xong)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --logs

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

- **v2.2 (2026-11-05)**:
  - **Đọc Log Tăng Trưởng Không Tốn Token (`--logs` & tích hợp trong `--heal`, #1662 / #1674)**: Nối trực tiếp vào `~/.agentmemory/mcp-crash.log` (cùng `.1` / `$TMPDIR`) và daemon logs (`agentmemory.error.log`, `agentmemory.log`) kèm bộ nhớ con trỏ `~/.agentmemory/.log-heal-cursor.json` (`ino`, `offset`) giúp bỏ qua 100% các file/dòng log đã đọc và đã sửa xong (`0 bytes` đọc lại).
  - **Smart AI Router v2.2 (`router/smart-router.mjs`)**: Bổ sung **Chống lưu câu trả lời cụt (#1495)** (`finish_reason === "length"` và kiểm tra đóng thẻ XML `<summary>`/`<observation>`/`<entities>`) và **Cắt chuỗi an toàn Surrogate (#1598)** (`sliceHeadSurrogateSafe`, `sliceTailSurrogateSafe`).
  - **Xóa 5 tầng KV kèm dọn dẹp Facet & Membership (`--delete`, #1642)**: Tự động xóa sạch các `mem:facets`, `mem:graph:membership` và `mem:graph:edge-history` mồ côi khi xóa node.
  - **Tích hợp dọn dẹp tài nguyên v0.9.32 trong `--heal` (#1256, #1260, #1645, #1664)**: Tự động kích hoạt `mem::session-sweep` quét dọn session bỏ rơi, kiểm tra `mem:idx:bm25` `"legacy:sweep"`, lấy thống kê đồ thị giới hạn qua `mem::graph-stats` và tự động gỡ biến cũ `OPENAI_API_KEY_FOR_LLM`.
- **v2.1 (2026-11-05)**:
  - Bổ sung cơ chế tự chữa lành (`selfPatches`) trong `--heal` và `install.sh` tự động patch lại `maxReads: 4096` (`8MB`) và thêm `AGENTMEMORY_LLM_PROVIDER=openai`.
  - Bổ sung tự động khôi phục chỉ mục đồ thị (`POST /agentmemory/graph/index/resume`) trong `--heal`.
- **v2.0 (2026-11-05)**:
  - Thêm `--delete "<tên_hoặc_id>"`, `--heal` / `--drain`, Auto-Anchor Visibility Protection (`pageNodes[0..24]`), Same-Name Entity Collision Batching và Multi-Pass Boundary Sweep.
