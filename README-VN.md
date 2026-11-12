# AgentMemory Knowledge Graph Linker, Semantic Planner, Edge Compactor & Smart AI Router (v4.0)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Companion for AgentMemory](https://img.shields.io/badge/Companion%20For-rohitg00%2Fagentmemory-blue.svg)](https://github.com/rohitg00/agentmemory)

🌐 **Language / Ngôn ngữ:** [🇬🇧 English](./README.md) | **🇻🇳 Tiếng Việt**

> [!IMPORTANT]
> **Yêu cầu hệ sinh thái / Điều kiện tiên quyết:**
> Bộ công cụ này là skill bổ trợ thiết kế đặc thù cho dự án mã nguồn mở **[AgentMemory (`rohitg00/agentmemory`)](https://github.com/rohitg00/agentmemory)**.
> Skill tương tác trực tiếp với daemon `@agentmemory/agentmemory`, kết nối WebSocket qua `iii-sdk` (`ws://127.0.0.1:49134`) và đồ thị tri thức (`http://localhost:3113/#graph`). Máy cần cài đặt và chạy [AgentMemory](https://github.com/rohitg00/agentmemory) trước khi sử dụng.

Bộ công cụ **Hybrid Neuro-Symbolic Antigravity Skill (`agentmemory-graph-linker`)** kèm **Task-Aware Smart AI Router (v4.0)** tối ưu cho **Gemini 4 Hydrogen**: kết hợp kiểm toán đồ thị 0 token, mô phỏng ngân sách đọc `maxReads: 4096`, nén cạnh dư thừa an toàn (`edge-compactor.mjs`), lập kế hoạch gộp từ đồng nghĩa & liên kết hai chiều thời gian bi-temporal (`semantic-planner.mjs`), lưu trữ **Thùng Rác Lạnh (`~/.agentmemory/graveyard.jsonl`)** có thể khôi phục bằng `--restore`, tối ưu RAM/log cho `iii-engine`, và cổng kiểm định bắt buộc `--verify-json [--strict]` — đồng thời giữ nguyên tương thích `--beautify` / `--auto` tốn 0 token.

---

## ✨ Tính năng nổi bật (v4.0)

1. **Cổng Kiểm Định Bắt Buộc (`--verify-json [--strict]`)**:
   - Kiểm tra bất biến không phá hủy dữ liệu qua `queryGraph`, `/agentmemory/graph/index`, `/agentmemory/graph/stats`, `performGraphAudit` và `maintenance.lock`.
   - Xuất JSON có cấu trúc (`status: "verified" | "failed"`, `version: "4.0"`, `invariants`, `checks`) và chỉ trả exit code `0` khi `unlinkedCount === 0 && globalDeg0Count === 0 && incompleteRecords === 0 && auditReducible === 0 && (!strict || !truncated)`.
2. **Mô Phỏng Ngân Sách Đọc & Nén Cạnh An Toàn (`--simulate-budget` & `--compact-edges`)**:
   - Tính toán chi phí đọc KV cho top-500 `pageNodes` theo giới hạn `maxReads: 4096` (`8MB`), chỉ điểm các `hotHubs` gây `truncated: true`, và dọn các cạnh heuristic `related_to` trọng số thấp (`weight <= 0.45`) vào `graveyard.jsonl` (mặc định dry-run; truyền `--apply` để thực thi).
   - Bảo vệ tuyệt đối `minDegree >= 2` (không bao giờ làm đứt liên kết tạo node bậc 0) và giữ nguyên các cạnh ngữ nghĩa mạnh (`fixes`, `depends_on`, `imports`, `modifies`, `uses` hoặc `weight >= 0.8`).
3. **Gộp Thực Thể Ngữ Nghĩa & Đồ Thị Bi-Temporal (`--suggest-merges`, `--merge-plan`, `--suggest-links`, `--apply-temporal`)**:
   - `--suggest-merges` chấm điểm các cặp đồng nghĩa/alias tốn 0 token (`scoreSynonymPair`); `--merge-plan` thực thi gộp 5 tầng KV theo phán đoán của Hydrogen, giới hạn `node.aliases <= 10` và `sourceObservationIds <= 24` để luôn dưới ngưỡng `MAX_POSTINGS=192`.
   - `--suggest-links` gom các node rời rạc / ít liên kết `related_to` kèm trích đoạn `mem:obs:*` và danh sách hub ứng viên; `--apply-temporal` ghi nhận các quan hệ giàu ngữ nghĩa (`implements`, `configures`, `replaces`, `caused_by`, `optimizes`, `fixes`, `depends_on`, `supersedes`, ...) cùng siêu dữ liệu thời gian (`tvalid`, `tvalidEnd`, `isLatest`, `supersededBy`).
4. **Task-Aware Smart AI Router v4.0 (`router/smart-router.mjs`)**:
   - Phân luồng thông minh: tác vụ `<observation>` / `any` đi qua chuỗi nhanh & hạn mức cao (`gemini-3.1-flash-lite-preview`, `gemini-flash-lite-latest`, `openai/gpt-oss-20b`, ...), còn `<summary>` / `<entities>` / `graph` ưu tiên độ chính xác cao (`gemini-3.8-flash`, `gemini-flash-latest`, `openai/gpt-oss-120b`, `gemma-4-26b-a4b-it`, ...) trước khi fallback xuống Z Fold 3 cục bộ và Local Extractive Fallback.
   - Làm sạch XML `<observation>` / `<summary>` (`sanitizeObservationOrSummaryXml`), hỗ trợ cả thẻ `<entity>` / `<relationship>` có thân thẻ, trích xuất file/concept thật trong fallback cục bộ (không gắn nhầm cạnh `~/.agentmemory/.env` giả), và trả `chains: { fast, accuracy }` qua `GET /`.
5. **Khóa Bảo Trì, Kiểm Toán 0 Token, Khử Trùng 5 Tầng & Thùng Rác Lạnh (`--lock`, `--unlock`, `--audit`, `--dedup`, `--rename`, `--prune`, `--restore`, `--delete`)**:
   - `--lock` / `--unlock` đóng băng LLM trích xuất nền qua `~/.agentmemory/maintenance.lock` (`0ms`, `0` token); tự động khóa khi chạy `--beautify` và `--optimize-ram`.
   - `--audit` phát hiện bản sao XML (`&amp;quot;`), cụm lỗi kiểu Sentry, ký tự gạch nối Unicode `‑` (`\u2010-\u2015\u2212\u00ad`), ảo giác CJK / ngoài luồng và file tạm trong `<400ms` tốn 0 token.
   - **Kim Bài Miễn Tử (Immunity Whitelist)** bảo vệ `decision`, `preference`, `pattern`, `person`, `project`, `milestone`, `song`, `error` đã có cạnh `fixes`, các anchor chủ đề và hub `degree >= 4`; mọi node/cạnh bị dọn hoặc gộp đều được lưu vào `~/.agentmemory/graveyard.jsonl` để khôi phục không mất dữ liệu bằng `--restore`.
6. **Ổn Định Session, Tối Ưu RAM `iii-engine` & Đọc Log 0 Token (`--optimize-ram`, `--heal`, `--logs`)**:
   - Thiết lập `MAX_OBS_PER_SESSION=0` (không giới hạn số observation mỗi session để tránh lỗi dead-letter) và `AGENTMEMORY_CAPTURE_OUTPUT_MAX=3500`, vá giải mã XML `parseAttrs(raw)`, bổ sung watermark `event::session::stopped` (`graph_wm:<sessionId>`), thêm bộ lọc rác & chống node mồ côi cho `extractGraphHeuristics` / `mem::graph-extract`, và đọc log tăng trưởng qua con trỏ byte-offset (`~/.agentmemory/.log-heal-cursor.json`).

---

## 📂 Cấu trúc thư mục

```text
agentmemory-graph-linker/
├── LICENSE                                        # Giấy phép mã nguồn mở MIT
├── README.md                                      # Tài liệu tiếng Anh (Mặc định)
├── README-VN.md                                   # Tài liệu tiếng Việt
├── install.sh                                     # Script cài đặt tự động & vá hệ thống v4.0
├── skill/
│   └── agentmemory-graph-linker/
│       ├── SKILL.md                               # Skill Hybrid Neuro-Symbolic cho Gemini 4 Hydrogen (v4.0)
│       ├── REFERENCE.md                           # Chi tiết ngân sách 4096, 5 tầng KV, semantic/temporal & changelog
│       └── scripts/
│           ├── graph-linker.mjs                   # CLI thực thi & cổng kiểm định (v4.0)
│           ├── edge-compactor.mjs                 # Mô phỏng ngân sách đọc & nén cạnh dư thừa an toàn
│           └── semantic-planner.mjs               # Chấm điểm đồng nghĩa, gộp alias & liên kết bi-temporal
├── router/
│   ├── smart-router.mjs                           # Task-Aware Smart AI Router v4.0 (đọc key từ ~/.agentmemory/.env)
│   └── com.agentmemory.smartrouter.plist.example  # Mẫu LaunchAgent tự chạy ngầm trên macOS
└── tests/
    ├── edge-compactor.test.mjs                    # Bộ test node:test cho mô phỏng ngân sách & nén cạnh
    ├── graph-linker.test.mjs                      # Bộ test node:test cho chuẩn hóa, dedup & CLI help
    ├── semantic-planner.test.mjs                  # Bộ test node:test cho synonym scoring & gộp giới hạn
    └── smart-router.test.mjs                      # Bộ test node:test cho tiering, lọc XML & fallback
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
SCRIPT=~/.gemini/config/skills/agentmemory-graph-linker/scripts/graph-linker.mjs

# 1. Kiểm tra trạng thái đồ thị & các bất biến nền
node "$SCRIPT" --status
node "$SCRIPT" --verify-json [--strict]

# 2. Trích xuất ứng viên tốn 0 token & mô phỏng ngân sách đọc 4096
node "$SCRIPT" --audit [--days 14]
node "$SCRIPT" --simulate-budget [--limit N] [--target-reads N] [--query-limit N]
node "$SCRIPT" --suggest-merges [--limit N] [--min-score S] [--same-type-only]
node "$SCRIPT" --suggest-links [--limit N]

# 3. Thực thi nguyên tử trên 5 tầng KV + Thùng Rác Lạnh
node "$SCRIPT" --lock "Manual refactoring"
node "$SCRIPT" --dedup
node "$SCRIPT" --merge-plan '<json_or_file>' [--dry-run]
node "$SCRIPT" --prune [--days 14] [--include-stale] [--include-hallucinations] [--no-hallucinations]
node "$SCRIPT" --apply-temporal '<json_or_file>' [--dry-run]
node "$SCRIPT" --compact-edges [--apply] [--target-reads N] [--limit N] [--query-limit N]
node "$SCRIPT" --unlock

# 4. Đổi tên tại chỗ, khôi phục từ Thùng Rác Lạnh & xóa node chỉ định
node "$SCRIPT" --rename "Tên Cũ hoặc gn_id" "Tên Mới Chuẩn" [--type <new_type>]
node "$SCRIPT" --restore --list
node "$SCRIPT" --restore --last
node "$SCRIPT" --restore "Tên Node hoặc gn_id"
node "$SCRIPT" --delete "Tên Node 1" "gn_id_2"

# 5. Fallback liên kết 0 token, tối ưu RAM & bảo trì hệ thống/log
node "$SCRIPT" --beautify
node "$SCRIPT" --auto
node "$SCRIPT" --dump
node "$SCRIPT" --apply /path/to/links.json
node "$SCRIPT" --optimize-ram
node "$SCRIPT" --heal                              # alias: --drain
node "$SCRIPT" --logs [--reset-cursor]
node "$SCRIPT" --help                              # hoặc -h

# 6. Cổng kiểm định bắt buộc sau khi chỉnh sửa đồ thị
node "$SCRIPT" --verify-json --strict
```

---

## 📋 Changelog (Lịch sử phiên bản)

- **v4.0 (2026-11-13)**:
  - **Nâng cấp Hybrid Neuro-Symbolic (Gemini 4 Hydrogen)**: Bổ sung `edge-compactor.mjs` (`--simulate-budget`, `--compact-edges [--apply]`), `semantic-planner.mjs` (`--suggest-merges`, `--merge-plan`, `--suggest-links`, `--apply-temporal`) và cổng kiểm định `--verify-json [--strict]`.
  - **Task-Aware Smart AI Router v4.0**: Tách `FAST_MODEL_ORDER` và `ACCURACY_MODEL_ORDER` (`selectTargetsForFormat`), bổ sung `gemini-flash-latest`, sửa lỗi fallback `<observation>` bị gán cứng `.env`, hỗ trợ làm sạch thẻ XML `<entity>`/`<relationship>` có thân thẻ, và thêm entrypoint guard + bộ `tests/*.test.mjs`.
- **v3.2 (2026-11-09)**:
  - Chuyển `MAX_OBS_PER_SESSION=0` (không giới hạn) để tránh rớt observation vào dead-letter, bảo vệ cụm nhạc/Hi-Res Audio (`song`), thêm watermark `event::session::stopped` (`graph_wm:<sessionId>`), bộ lọc rác & chống orphan trong `extractGraphHeuristics`, làm sạch XML `<observation>`/`<summary>`, và chuẩn hóa gạch nối Unicode `‑` (`normalizeSoftHyphens`).
- **v3.1 (2026-11-08)**:
  - Bổ sung Chế độ Khóa Bảo Trì (`--lock` & `--unlock`) và cổng chặn ảo giác CJK / ngoài luồng.
- **v3.0 (2026-11-07)**:
  - Bổ sung `--audit`, `--dedup` kiểu Sentry, `--rename` 5 tầng KV, Thùng Rác Lạnh (`~/.agentmemory/graveyard.jsonl`) với `--prune` / `--restore`, `--optimize-ram`, và tự vá giải mã XML `parseAttrs`.
- **v2.2 (2026-11-05)**:
  - Bổ sung Đọc Log Tăng Trưởng Không Tốn Token (`--logs` & `--heal`, #1662 / #1674), Smart AI Router chống lưu câu trả lời cụt (#1495) & cắt chuỗi Surrogate-safe (#1598), và xóa 5 tầng KV kèm Facet (#1642).
- **v2.1 (2026-11-05)**:
  - Bổ sung tự động vá `maxReads: 4096` (`8MB`) và tự động khôi phục chỉ mục đồ thị bị tạm dừng.
- **v2.0 (2026-11-05)**:
  - Thêm `--delete`, `--heal` / `--drain`, Auto-Anchor Visibility Protection (`pageNodes[0..24]`), Same-Name Entity Collision Batching và Multi-Pass Boundary Sweep.

---

## 📄 Bản quyền (License)

Dự án được phân phối dưới giấy phép mã nguồn mở [MIT License](./LICENSE) - xem chi tiết tại file [LICENSE](./LICENSE).
