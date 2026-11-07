# AgentMemory Knowledge Graph Linker, Deduplicator, Cleaner & Smart AI Router (v3.0)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Companion for AgentMemory](https://img.shields.io/badge/Companion%20For-rohitg00%2Fagentmemory-blue.svg)](https://github.com/rohitg00/agentmemory)

🌐 **Language / Ngôn ngữ:** [🇬🇧 English](./README.md) | **🇻🇳 Tiếng Việt**

> [!IMPORTANT]
> **Yêu cầu hệ sinh thái / Điều kiện tiên quyết:**
> Bộ công cụ này là skill bổ trợ thiết yếu được thiết kế đặc thù cho dự án mã nguồn mở **[AgentMemory (`rohitg00/agentmemory`)](https://github.com/rohitg00/agentmemory)**.
> Skill tương tác trực tiếp với daemon của `@agentmemory/agentmemory`, kết nối WebSocket qua `iii-sdk` (`ws://127.0.0.1:49134`), và giao diện đồ thị tri thức (`http://localhost:3113/#graph`). Máy bạn cần cài đặt và chạy [AgentMemory](https://github.com/rohitg00/agentmemory) để sử dụng toàn bộ tính năng.

Bộ công cụ **Antigravity Skill (`agentmemory-graph-linker`)** kèm **Smart AI Router 11 tầng (v3.0)** giúp tự động nối các node rời rạc (`UNLINKED / NO RELATIONS YET`), kiểm toán & lọc bỏ "ảo giác" từ các API miễn phí với **chi phí 0 token**, gộp các node lỗi/thực thể trùng lặp trên cả 5 tầng KV, đổi tên node tại chỗ an toàn, dọn các node tạm vào **Thùng Rác Lạnh (`~/.agentmemory/graveyard.jsonl`)** có thể khôi phục 100% bằng `--restore`, tối ưu hóa mạnh mẽ dung lượng RAM của `iii-engine`, đọc & tự sửa lỗi từ `mcp-crash.log` / daemon log bằng **con trỏ byte-offset tiết kiệm 100% token**, và làm đẹp đồ thị tri thức [AgentMemory](https://github.com/rohitg00/agentmemory) (`http://localhost:3113/#graph`).

---

## ✨ Tính năng nổi bật (v3.0)

1. **Kiểm Toán Nguồn Gốc & Bắt "Ảo Giác" Tốn 0 Token (`--audit`)**:
   - Đối chiếu toàn bộ các node trên đồ thị với kho dữ liệu `mem:obs:*`, `mem:memories` và `mem:summaries` cục bộ kết hợp **Từ điển Kỹ thuật (Tech Lexicon)** và bộ lọc ảo giác ngoài luồng trong `< 400ms` qua WebSocket.
   - Bắt gọn các node "ảo giác ngáo" do model miễn phí tự bịa (như *"invasion German"*, *"Craig"*, *"Fightnite"*, lỗi sai dấu tên riêng), lỗi mã hóa lặp entity XML (`&amp;quot;`), cụm lỗi trùng lặp và file tạm mà **không tốn bất kỳ 1 lượt gọi API hay token LLM nào**.
2. **Gộp Lỗi Kiểu Sentry & Đổi Tên Nguyên Tử Trên 5 Tầng KV (`--dedup` & `--rename`)**:
   - Gom các biến thể lỗi lặp (ví dụ 17 node lỗi `ProcessException: exit code 72 ... xcodebuild`), các node trùng tên khác hoa/thường (`Flutter` vs `flutter`), và các node bị nhân bản `&amp;lt;` về **1 Node Chuẩn (Canonical Node)** duy nhất; tự động chuyển hướng toàn bộ cạnh liên kết trên cả 5 tầng KV và cộng dồn chỉ số `properties.occurrences`.
   - `--rename "<tên_cũ>" "<tên_mới>" [--type <loại>]` đổi tên node tại chỗ trên cả 5 tầng KV mà không làm hỏng chỉ mục `mem:graph:retrieval-data` (hoặc tự động gộp nếu tên mới đã tồn tại).
   - Tự động vá hàm `parseAttrs(raw)` trong `dist/*.mjs` của AgentMemory để giải mã trực tiếp các thực thể XML (`&quot;`, `&lt;`, `&gt;`, `&amp;`), chấm dứt vĩnh viễn lỗi nhân bản `&amp;quot;`.
3. **Thùng Rác Lạnh (`~/.agentmemory/graveyard.jsonl`) & Kim Bài Miễn Tử (`--prune` & `--restore`)**:
   - **Kim Bài Miễn Tử (Immunity Whitelist)**: Bảo vệ tuyệt đối các node `decision`, `preference`, `pattern`, `person`, `project`, `milestone`, mọi node `error` đã có cạnh `fixes` giải quyết, các anchor chủ đề và các node trung tâm có `degree >= 4`.
   - **Lưu trữ lạnh không mất dữ liệu**: Trước khi `--prune`, `--dedup` hoặc `--delete` xóa bất kỳ node nào khỏi 5 tầng KV, toàn bộ dữ liệu Node + các Cạnh liên đới + Facets đều được ghi ra `~/.agentmemory/graveyard.jsonl`. Cần khôi phục lại bất cứ lúc nào chỉ cần chạy `--restore "<tên_hoặc_id>"` (hoặc `--restore --last`).
4. **Tối Ưu Hóa Thực Chiến RAM Cho `iii-engine` (`--optimize-ram`)**:
   - Giải phóng hàng chục nghìn bản ghi danh sách liên kết đôi trong `mem:graph:retrieval-data` khỏi bộ nhớ RAM của tiến trình Rust `iii-engine`, đồng thời tinh chỉnh `MAX_OBS_PER_SESSION=800` & `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500` trong `~/.agentmemory/.env`.
5. **Đọc Log Tăng Trưởng Không Tốn Token (`--logs` & `--heal`, #1662 / #1674) & Smart AI Router v3.0**:
   - Lưu vị trí con trỏ `{ ino, offset, mtimeMs }` tại `~/.agentmemory/.log-heal-cursor.json` giúp bỏ qua 100% các dòng log đã đọc (`unreadBytesRead: 0`).
   - `smart-router.mjs` v3.0 tích hợp chống lưu câu trả lời cụt (#1495), cắt chuỗi an toàn Surrogate (#1598), giải mã entity XML lồng nhau và cổng chặn thực thể rác/ảo giác ngay từ đầu vào.

---

## 📂 Cấu trúc thư mục

```text
agentmemory-graph-linker/
├── LICENSE                                        # Giấy phép mã nguồn mở MIT
├── README.md                                      # Tài liệu hướng dẫn tiếng Anh (Mặc định)
├── README-VN.md                                   # Tài liệu hướng dẫn tiếng Việt
├── install.sh                                     # Script cài đặt tự động 1 lệnh & vá hệ thống v3.0
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill cho Antigravity (v3.0)
│       ├── REFERENCE.md                           # Kiến trúc 5 tầng KV, Thùng rác lạnh, tối ưu RAM & changelog
│       └── scripts/
│           └── graph-linker.mjs                   # CLI thực thi (--status, --audit, --dedup, --rename, --prune, --restore, --optimize-ram, --beautify, --delete, --heal, --logs, --dump, --apply, --auto)
└── router/
    ├── smart-router.mjs                           # Smart AI Router v3.0 (đọc API key từ ~/.agentmemory/.env)
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

```bash
# 1. Kiểm tra trạng thái đồ thị & số lượng node unlinked
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --status

# 2. Kiểm toán (Dry-run Audit): tìm nhóm node trùng, lỗi mã hóa XML, ảo giác & file rác (Chỉ xem, không xóa)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --audit

# 3. Gộp tự động 5 tầng KV: gom lỗi trùng kiểu Sentry, gộp node khác hoa/thường & làm sạch entity XML
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --dedup

# 4. Đổi tên/sửa nội dung node tại chỗ trên cả 5 tầng KV (hoặc tự gộp nếu tên mới đã tồn tại)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --rename "Tên Cũ hoặc gn_id" "Tên Mới Chuẩn"

# 5. Dọn các node tạm & ảo giác vào Thùng Rác Lạnh (~/.agentmemory/graveyard.jsonl) có Kim Bài Miễn Tử bảo vệ
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --prune

# 6. Xem danh sách hoặc Khôi phục 100% node + cạnh từ Thùng Rác Lạnh
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --restore --list
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --restore "Tên Node hoặc gn_id"

# 7. Tối ưu hóa RAM & Đồ thị 1 chạm (tinh chỉnh .env + vá XML + gộp node trùng + dọn rác vào graveyard + quét session)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --optimize-ram

# 8. Làm đẹp & phân bổ đều đồ thị thành 6 cụm chòm sao chủ đề + quét biên tự động (Khuyên dùng)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --beautify

# 9. Xóa vĩnh viễn các node chỉ định trên cả 5 tầng KV (vẫn được sao lưu vào graveyard.jsonl)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --delete "Tên Node 1" "gn_id_2"

# 10. Bảo trì 1 chạm: đọc/sửa log mới + xả spool + quét session bỏ rơi + kiểm tra index + rebuild snapshot
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --heal

# 11. Chỉ đọc phần byte mới phát sinh trong mcp-crash.log & daemon log (0 byte nếu đã đọc xong)
node ~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs --logs
```

---

## 📋 Changelog (Lịch sử phiên bản)

- **v3.0 (2026-11-07)**:
  - **Kiểm Toán Nguồn Gốc & Bắt Ảo Giác 0 Token (`--audit`)**: Đối chiếu node với toàn bộ kho `mem:obs:*`, `mem:memories`, `mem:summaries` và Từ điển Kỹ thuật trong `< 400ms` tốn 0 token LLM.
  - **Gộp Lỗi Kiểu Sentry & Khử Trùng Lặp 5 Tầng KV (`--dedup`)**: Gom các node lỗi lặp, node trùng khác hoa/thường và bản sao lỗi mã hóa XML về 1 Node Chuẩn, tự động chuyển hướng cạnh và cộng dồn `properties.occurrences`.
  - **Đổi Tên Node Nguyên Tử 5 Tầng KV (`--rename`)**: Đổi tên hoặc hợp nhất node đồng bộ trên `mem:graph:nodes`, `mem:graph:name-index`, `mem:graph:node-degree`, `mem:graph:retrieval-data` và `mem:graph:retrieval-control`.
  - **Thùng Rác Lạnh (`~/.agentmemory/graveyard.jsonl`) & Khôi Phục Không Mất Dữ Liệu (`--prune` & `--restore`)**: Bảo vệ tri thức quan trọng bằng Kim Bài Miễn Tử và sao lưu đầy đủ node + cạnh ra ổ cứng trước khi xóa khỏi RAM.
  - **Tối Ưu Hóa RAM `iii-engine` (`--optimize-ram`) & Tự Vá Giải Mã XML `parseAttrs`**: Hạ `MAX_OBS_PER_SESSION=800` & `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500`, vá hàm `parseAttrs(raw)` trong `dist/*.mjs` để tự giải mã entity XML, và nâng cấp `smart-router.mjs` lên v3.0.
- **v2.2 (2026-11-05)**:
  - Bổ sung Đọc Log Tăng Trưởng Không Tốn Token (`--logs` & `--heal`, #1662 / #1674), Smart AI Router v2.2 chống lưu câu trả lời cụt (#1495) & cắt chuỗi Surrogate-safe (#1598), và xóa 5 tầng KV kèm Facet (#1642).
- **v2.1 (2026-11-05)**:
  - Bổ sung tự động vá `maxReads: 4096` (`8MB`) và tự động khôi phục chỉ mục đồ thị bị tạm dừng.
- **v2.0 (2026-11-05)**:
  - Thêm `--delete`, `--heal` / `--drain`, Auto-Anchor Visibility Protection (`pageNodes[0..24]`), Same-Name Entity Collision Batching và Multi-Pass Boundary Sweep.

---

## 📄 Bản quyền (License)

Dự án được phân phối dưới giấy phép mã nguồn mở [MIT License](./LICENSE) - xem chi tiết tại file [LICENSE](./LICENSE).
