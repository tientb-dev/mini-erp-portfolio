# ADR-0013: Tồn kho có nguồn gốc (HĐ nguồn / Sales phụ trách / GR) và GR tham chiếu trên dòng GIR

- **Trạng thái:** Nghiệp vụ **đã chốt** (2026-11-13). Thiết kế kỹ thuật §3–§5 **đề xuất, chờ review** — chưa có migration.
- **Sửa đổi:** ADR-0004 (phần "Ngoài phạm vi: phân bổ theo HĐ"), ADR-0012 (người phụ trách nguồn hàng), 03 §4–§5.

## 1. Bối cảnh — quyết định nghiệp vụ
1. Mọi PR gắn HĐ; hàng nhập kho từ PR thuộc trách nhiệm **Sales phụ trách HĐ** đó. Tồn phải truy vết theo **Kho, Product, Sales phụ trách, HĐ nguồn, GR**.
2. Hai luồng GIR chính, giữ nguyên bốn luồng A/B/C/D (ADR-0012), hạn mức dòng PR/dòng HĐ, `PO done`, phân biệt GIR (đề nghị) với GI (thực xuất):
   - **Mua HĐ nào xuất HĐ đó** (A/C): GI chỉ dùng tồn có HĐ nguồn = HĐ của GIR.
   - **Hàng có sẵn** (B/D): được dùng tồn của HĐ/Sales khác; Sales quản lý nguồn đồng ý → Quản lý kho duyệt. Hoàn bù: thủ công.
3. PM lập GIR theo nhu cầu HĐ, không phụ thuộc tồn; GIR lập/duyệt khi chưa có GR; chỉ GI kiểm tồn khả dụng.
4. Dòng GIR (A/C) hiển thị tối đa một GR + kho: GR `APPROVED` đầu tiên của dòng PR, tự cập nhật kể cả GIR đã Gửi duyệt/đã duyệt; GR sau không ghi đè; không đổi số lượng/trạng thái; không giữ chỗ/phân bổ.
5. Nhập kho từng phần; dòng GIR có tình trạng Chưa nhập kho / Nhập kho một phần / Đã nhập kho.

## 2. Hiện trạng (khảo sát code, 2026-11-13)
| Điểm | Hiện trạng | Khoảng cách |
|---|---|---|
| `inventories` | Unique `(warehouse_id, product_id)`; `on_hand_quantity`, `reserved_quantity`, CHECK không âm, giữ chỗ ≤ tồn | Không có chiều nguồn |
| `inventory_transactions` | Biến động theo dòng chứng từ, unique chống ghi trùng | Không có chiều nguồn |
| `inventory_serials` | Theo `goods_receipt_detail_id` → truy được GR → GRR → PO → PR → HĐ | SN đã truy vết được; chỉ thiếu lọc theo nguồn khi GI |
| `goods_issue_request_lines` | `sales_contract_line_id NOT NULL`, không có `purchase_requisition_line_id` | Luồng A/C chưa có liên kết dòng PR (CT6/CT10) → chưa thể hiển thị GR tham chiếu |
| `sales_contracts` | Chỉ `created_by` | Chưa có "Sales phụ trách" (CT5) |
| GI chọn tồn | Theo Kho + PN | Chưa lọc theo HĐ nguồn/người phụ trách |

## 3. Phương án mô hình tồn đa chiều
Chiều nguồn gồm `(warehouse, product, source_sales_contract_id, owner_user_id, goods_receipt_id)`. HĐ nguồn và GR là dữ liệu bất biến sau Duyệt GR; Sales phụ trách suy ra từ HĐ nguồn (hoặc chụp lại khi duyệt GR — CT5).

| | **P1. Mở rộng khóa `inventories`** | **P2. Lô theo dòng GR (`inventory_lots`) + số dư tổng** | **P3. Stock ledger thuần (chỉ `inventory_transactions`, số dư = SUM)** | **P4. Stock ledger + inventory balance theo chiều nguồn** |
|---|---|---|---|---|
| Mô tả | Thêm cột HĐ nguồn/owner vào unique key `inventories` | Mỗi dòng GR Đã duyệt sinh một lô (kho, PN, HĐ nguồn, owner, GR line, on_hand, reserved); `inventories` giữ tổng Kho+PN | Bỏ bảng số dư; tính tồn bằng SUM ledger có chiều | Ledger có đủ chiều (bất biến tương đối, ADR-0004) + bảng balance khóa theo chiều nguồn, cập nhật cùng transaction |
| Truy vết GR | Không (gộp các GR cùng HĐ) | Có, tới dòng GR | Có | Có nếu balance theo GR line (≈ P2) |
| Không âm / giữ chỗ | CHECK trên dòng | CHECK trên lô + trên tổng | Không có dòng để CHECK; phải khóa tư vấn (advisory) — yếu | CHECK trên balance |
| Khóa đồng thời | 1 dòng | Nhiều lô (khóa theo id tăng dần) + dòng tổng | Khó | Như P2 |
| GI không SN | Trừ 1 dòng | Phải **phân bổ** qua nhiều lô (FIFO/chỉ định — CT3) | Như P2 | Như P2 |
| Thu hồi GR (03 §2.2) | Khó: không biết phần nào của GR đã xuất | Dễ: kiểm tra lô của GR còn đủ (on_hand − reserved ≥ lượng GR) | Kiểm tra SUM | Như P2 |
| Báo cáo đa chiều | Tốt | Tốt (GROUP BY lô) | Chậm khi lớn | Tốt |
| Migration | Vừa (đổi unique, backfill) | Vừa (bảng mới, backfill từ GR Đã duyệt) | Lớn (bỏ bảng số dư, đổi mọi bất biến) | Lớn |

**Đề xuất: P2 — lô theo dòng GR**, thực chất là "stock ledger + inventory balance" với balance ở hạt mịn nhất (dòng GR):
- `inventory_lots` (mới): `id`, `warehouse_id`, `product_id`, `goods_receipt_line_id` (unique), `source_sales_contract_id`, `owner_user_id`, `on_hand_quantity`, `reserved_quantity`, CHECK như `inventories`. HĐ nguồn/owner chụp lại khi Duyệt GR (không JOIN chuỗi PR mỗi lần xuất).
- `inventories` giữ nguyên làm **tổng Kho + PN** (màn tồn kho hiện có, khóa thô); bất biến: tổng = Σ lô.
- `inventory_transactions` thêm `inventory_lot_id` (dòng GI có thể sinh nhiều biến động, mỗi lô một dòng → unique chống ghi trùng đổi thành (nguồn, dòng nguồn, lô, loại)).
- `inventory_serials` thêm `inventory_lot_id` (hoặc suy ra từ `goods_receipt_detail_id` — đủ, có thể không cần cột).
- GI: lọc lô theo nguồn của GIR (A/C: `source_sales_contract_id` = HĐ của GIR; B/D: `owner_user_id` = người phụ trách đã đồng ý). Hàng có SN: lô xác định qua SN. Hàng không SN: cần quy tắc phân bổ (CT3) — đề xuất FIFO theo thời điểm duyệt GR, lưu `goods_issue_line_allocations` để Thu hồi GI/duyệt nhất quán.
- Thứ tự khóa: `inventories` → `inventory_lots` (id tăng dần) → `inventory_serials`.
- Thu hồi GR Đã duyệt: khóa lô của GR, điều kiện `on_hand − reserved ≥ lượng GR` (tương đương và chặt hơn 03 §2.2 vì xét đúng lô), xóa lô + biến động.

Lý do loại: P1 mất truy vết GR và làm Thu hồi GR sai; P3 mất CHECK không âm (vi phạm CLAUDE.md "ràng buộc DB là lớp bảo vệ cuối"); P4 đầy đủ nhưng ledger bất biến + reversal là thay đổi lớn ADR-0004 đã loại cho MVP.

## 4. GR tham chiếu trên dòng GIR
| | **Q1. Lưu cột trên dòng GIR, ghi khi Duyệt GR** | **Q2. Tính khi đọc (GR `APPROVED` sớm nhất của dòng PR)** | **Q3. Lưu trên dòng PR (`first_goods_receipt_id`), GIR JOIN khi đọc** |
|---|---|---|---|
| Đúng "không ghi đè" | Có (`WHERE first_goods_receipt_id IS NULL`) | Đúng trừ khi GR đầu bị Thu hồi → nhảy sang GR kế | Có |
| Dòng GIR tạo sau | Phải copy từ dòng PR lúc tạo | Tự có | Tự có |
| Phụ thuộc module | Inbound → Outbound (cạnh **mới**, ngược hướng hiện có) | Outbound đọc bảng Inbound (phá ranh giới) | Inbound → Procurement facade — **đã có** (ADR-0003) |
| Đổi trạng thái GIR | Không | Không | Không |

**Đề xuất: Q3.** Dòng PR là nơi Inbound đã cập nhật số tổng hợp qua facade Procurement (ADR-0003); thêm `purchase_requisition_lines.first_goods_receipt_id` (+ kho suy ra từ GR) ghi bằng `UPDATE … WHERE first_goods_receipt_id IS NULL` trong transaction Duyệt GR, dưới khóa dòng PO đã có. Cùng chỗ đó cộng `received_quantity` cho dòng PR → tính tình trạng nhập kho. GIR đọc qua facade Procurement (Outbound → Procurement là phụ thuộc đã dự kiến ở CT8). Không chạm bảng GIR → không thể làm đổi số lượng/trạng thái GIR.

## 5. Điều kiện trước khi triển khai
Phụ thuộc các điểm chưa chốt — **không triển khai theo giả định**:
- CT5: trường "Sales phụ trách" trên HĐ (owner của lô).
- CT6/CT10: liên kết dòng GIR → dòng PR và biểu diễn luồng A/C (cần trước Q3 có ý nghĩa hiển thị).
- CT3: quy tắc phân bổ hàng không SN giữa các lô cùng nguồn.
- CT11: GR tham chiếu bị Thu hồi. CT12: căn cứ tình trạng nhập kho.
- CT13: luồng B/D có hiển thị GR tham chiếu không; "GIR không phụ thuộc tồn" có áp cho B/D không.

## Hệ quả
- Tồn kho hết "dùng chung theo Kho + PN" ở mức xuất; màn tồn kho tổng vẫn đúng.
- GI không SN phức tạp hơn (phân bổ nhiều lô); cần test PostgreSQL thật cho đồng thời và Thu hồi GR.
- Dữ liệu GR Đã duyệt hiện có cần backfill lô; owner backfill phụ thuộc CT5.
