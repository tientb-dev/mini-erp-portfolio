# ADR-0013: Tồn kho có nguồn gốc (HĐ nguồn / Sales phụ trách / GR) và GR tham chiếu trên dòng GIR

- **Trạng thái:** Nghiệp vụ **đã chốt** (2026-11-13/14; CT3, CT5, CT10–CT16). Thiết kế kỹ thuật §3–§6 **đề xuất, chờ review** — chưa có migration.
- **Sửa đổi:** ADR-0004 (phần "Ngoài phạm vi: phân bổ theo HĐ"), ADR-0012 (người phụ trách nguồn hàng), 03 §1, §2.2, §3, §4, §5.

## 1. Quyết định nghiệp vụ
1. Mọi PR gắn HĐ. Mỗi HĐ có **Sales phụ trách được chỉ định rõ**; hàng nhập qua GR kế thừa Sales phụ trách từ HĐ nguồn (CT5). Tồn truy vết theo **Kho, Product, Sales phụ trách, HĐ nguồn, GR**.
2. Giữ nguyên bốn luồng A/B/C/D (ADR-0012), hạn mức dòng PR/dòng HĐ, `PO done`, phân biệt GIR (đề nghị) với GI (thực xuất):
   - **Mua HĐ nào xuất HĐ đó** (A/C): dòng GIR tham chiếu chính xác một dòng PR (CT10); GI chỉ dùng tồn có HĐ nguồn = HĐ của GIR. GIR được Gửi duyệt khi chưa có GR, không kiểm tồn.
   - **Hàng có sẵn** (B/D): được dùng tồn của HĐ/Sales khác; Sales nguồn đồng ý → Quản lý kho duyệt; phải đủ tồn khả dụng khi Gửi duyệt, không giữ chỗ (CT13). Hoàn bù: thủ công.
   - GI luôn kiểm tra lại tồn khi thực xuất.
3. Hàng không SN xuất **FIFO theo thời điểm Duyệt GR**, chỉ trong các lô thuộc phạm vi nguồn được phép (CT3).
4. Dòng GIR A/C hiển thị tối đa một GR + kho: GR `APPROVED` đầu tiên của dòng PR; tự cập nhật kể cả GIR đã Gửi duyệt/đã duyệt; GR sau không ghi đè; không đổi số lượng/trạng thái; không giữ chỗ/phân bổ.
5. Thu hồi GR bị chặn nếu GR đang là GR tham chiếu của dòng GIR chưa `CANCELED`; nếu không, vẫn qua kiểm tra tồn kho phụ thuộc; không tự chuyển GR tham chiếu (CT11).
6. Chưa nhập kho / Nhập kho một phần / Đã nhập kho là tình trạng của **PO**, chỉ tính GR `APPROVED` còn hiệu lực (CT12).
7. Thu hồi GR bị chặn nếu lô của GR đã được GI phân bổ/giữ chỗ hoặc đã xuất; không tự phân bổ lại (CT14). Thu hồi hợp lệ → GR tham chiếu của dòng PR chuyển sang GR `APPROVED` còn hiệu lực sớm nhất (nếu có).
8. Lô giữ Sales phụ trách tại thời điểm Duyệt GR; đổi Sales trên HĐ không đổi lô cũ (CT15).
9. GIR B/D: **một HĐ nguồn → một HĐ đích**, một Sales nguồn, một kho, nhiều Product (CT16). Lưu `DRAFT` khi chưa đủ tồn; bắt buộc đủ tồn khi Gửi duyệt; kiểm lại khi Sales nguồn đồng ý và Quản lý kho duyệt.

## 2. Hiện trạng (khảo sát code, 2026-11-13)
| Điểm | Hiện trạng | Khoảng cách |
|---|---|---|
| `inventories` | Unique `(warehouse_id, product_id)`; `on_hand_quantity`, `reserved_quantity`, CHECK không âm, giữ chỗ ≤ tồn | Không có chiều nguồn |
| `inventory_transactions` | Biến động theo dòng chứng từ, unique chống ghi trùng | Không có chiều nguồn; một dòng GI = một biến động |
| `inventory_serials` | Theo `goods_receipt_detail_id` → truy được GR → GRR → PO → PR → HĐ | Thiếu lọc theo nguồn khi GI |
| `goods_issue_request_lines` | `sales_contract_line_id NOT NULL`, không có `purchase_requisition_line_id` | Thiếu liên kết dòng PR (CT6) |
| `sales_contracts` | Chỉ `created_by` | Thiếu Sales phụ trách |
| Thu hồi GR Đã duyệt | Chưa có (IM11) | Thiết kế mới theo lô |
| Tình trạng nhập PO | Chưa có số tổng hợp (IM11) | Cần `received_quantity` trên dòng PO (ADR-0003) |

## 3. Phương án mô hình tồn đa chiều
| | **P1. Mở rộng khóa `inventories`** | **P2. Lô theo dòng GR (`inventory_lots`) + số dư tổng** | **P3. Stock ledger thuần (số dư = SUM)** | **P4. Ledger bất biến + balance theo chiều** |
|---|---|---|---|---|
| Truy vết GR | Không | Có, tới dòng GR | Có | Có |
| FIFO | Không làm được | Theo `approved_at` của lô | Phải tính lại từ ledger | Như P2 |
| Không âm / giữ chỗ | CHECK trên dòng | CHECK trên lô + tổng | Không có dòng để CHECK | CHECK trên balance |
| Thu hồi GR | Sai (không biết phần đã xuất) | Xét đúng lô | SUM | Như P2 + bút toán đảo |
| Migration | Vừa | Vừa | Lớn | Lớn |

**Đề xuất: P2** ("ledger + balance" với balance ở hạt dòng GR). Lý do loại: P1 không FIFO/truy vết GR; P3 mất CHECK (vi phạm "ràng buộc DB là lớp bảo vệ cuối"); P4 cần reversal ledger mà ADR-0004 đã loại cho MVP.

Thiết kế P2:
- `sales_contracts.responsible_sales_user_id` (NOT NULL sau backfill — giá trị backfill cho HĐ cũ: cần quyết định, mặc định đề xuất `created_by`).
- `inventory_lots`: `id`, `warehouse_id`, `product_id`, `goods_receipt_line_id` (unique), `source_sales_contract_id`, `owner_user_id`, `approved_at`, `on_hand_quantity`, `reserved_quantity`; CHECK như `inventories`. HĐ nguồn và Sales **chụp khi Duyệt GR** (không JOIN chuỗi PR khi xuất). Index `(warehouse_id, product_id, source_sales_contract_id, approved_at, id)` và `(warehouse_id, product_id, owner_user_id, approved_at, id)`.
- `goods_issue_requests` (B/D) thêm `source_sales_contract_id`, `source_owner_user_id` (NOT NULL khi `issue_type = AVAILABLE_STOCK`, CHECK). Phạm vi nguồn của GIR = (kho, HĐ nguồn, Sales nguồn) — mọi kiểm tồn và FIFO B/D lọc lô theo đúng bộ này (định nghĩa Sales nguồn: CT17). A/C: phạm vi = (kho GI, HĐ của GIR), mọi Sales của lô.
- `inventories` giữ làm **tổng Kho + PN**; bất biến: tổng = Σ lô (truy vấn đối chiếu làm test).
- `goods_issue_line_allocations` (`goods_issue_line_id`, `inventory_lot_id`, `quantity`): kết quả FIFO tính **khi Gửi duyệt GI** (khóa lô theo `approved_at, id`, lấy dần đến đủ; thiếu → chặn nguyên GI), cộng `reserved_quantity` của lô và tổng; Duyệt GI trừ `on_hand`/`reserved` đúng các lô đã phân bổ (không tính lại FIFO); Từ chối/Thu hồi GI xóa phân bổ và giải phóng. Phân bổ của GI `APPROVED` giữ vĩnh viễn (truy vết xuất theo lô). SN: phân bổ suy ra từ lô của SN, cũng ghi vào bảng này để điều kiện Thu hồi GR chỉ cần một truy vấn.
- Cột `inventory_lots.received_quantity` (bất biến) để kiểm tra "lô chưa bị đụng": `on_hand = received AND reserved = 0`; kết hợp `NOT EXISTS` phân bổ của GI chưa Hủy làm điều kiện Thu hồi GR (CT14). GI `DRAFT` không SN không có phân bổ nên không chặn; GI `DRAFT` có SN chặn qua quy tắc SN hiện có.
- `inventory_transactions` thêm `inventory_lot_id`; unique chống ghi trùng đổi thành (nguồn, dòng nguồn, lô, loại).
- Thứ tự khóa: `inventories` → `inventory_lots` (theo `approved_at, id`) → `inventory_serials`.
- Tình trạng nhập PO: `purchase_order_lines.received_quantity` do Inbound cộng/trừ qua facade Procurement khi Duyệt/Thu hồi GR (ADR-0003); trạng thái PO suy ra từ các dòng.

## 4. GR tham chiếu trên dòng GIR
| | **Q1. Cột trên dòng GIR** | **Q2. Tính khi đọc** | **Q3. Cột trên dòng PR, GIR đọc qua facade** |
|---|---|---|---|
| "Không ghi đè" | Có | Không ổn định | Có |
| Dòng GIR tạo sau | Phải copy | Tự có | Tự có |
| Phụ thuộc module | Inbound → Outbound (cạnh mới) | Outbound đọc bảng Inbound | Inbound → Procurement — đã có |

**Đề xuất: Q3.** `purchase_requisition_lines.first_goods_receipt_id`; ghi bằng `UPDATE … WHERE first_goods_receipt_id IS NULL` trong transaction Duyệt GR, dưới khóa dòng PO. Kho suy ra từ GR. Không chạm bảng GIR.

**Thu hồi GR (CT11)** trong một transaction:
1. Khóa dòng PR có `first_goods_receipt_id` = GR (FOR UPDATE) — tuần tự hóa với tạo/Gửi duyệt GIR A/C trên cùng dòng PR (thứ tự khóa dòng HĐ → dòng PR → dòng GIR, CT8).
2. Có dòng GIR chưa `CANCELED` tham chiếu dòng PR đó → chặn `GR_REFERENCED_BY_GIR`.
3. Khóa `inventories` → lô của GR → SN; chặn nếu lô có phân bổ của GI `WAITING_FOR_APPROVE`/`APPROVED` hoặc `on_hand ≠ received`/`reserved > 0`, hoặc SN còn được GI chưa Hủy tham chiếu (`GR_STOCK_IN_USE`). Không phân bổ lại.
4. Hoàn tác tồn; trừ `received_quantity` dòng PO; `first_goods_receipt_id` → GR `APPROVED` còn hiệu lực có `approved_at` sớm nhất khác của dòng PR, không có → NULL (đã chốt 2026-11-14). Không có GIR hiệu lực nào bị đổi (bước 2 đảm bảo). Cần `goods_receipts.approved_at` của lần duyệt còn hiệu lực (Duyệt lại sau Thu hồi ghi đè).

## 5. Rủi ro kỹ thuật còn mở
| # | Rủi ro | Hướng xử lý đề xuất |
|---|---|---|
| R1 | CT14 làm Thu hồi GR không SN chặt hơn quy tắc cũ: một GI nhỏ xuất từ lô là GR không Thu hồi được dù kho còn đủ hàng cùng loại | Đúng nghiệp vụ đã chốt; UI hiển thị GI đang chặn |
| R2 | FIFO dồn phân bổ vào lô cũ nhất → GR cũ nhất (thường là GR tham chiếu) gần như không bao giờ Thu hồi được sau khi có GI | Chấp nhận; ghi chú trong hướng dẫn sử dụng |
| R3 | Deadlock: GI khóa nhiều lô theo FIFO, Thu hồi GR khóa lô của GR, Duyệt GR thêm lô mới | Thứ tự khóa cố định `inventories` (id) → `inventory_lots` (`approved_at, id`) → `inventory_serials` (id); dòng PR khóa trước `inventories`; test PostgreSQL đồng thời (B20, B26, C80) |
| R4 | FIFO tính lúc Gửi duyệt GI; GR Thu hồi rồi Duyệt lại có `approved_at` mới → lô "trẻ" lại | FIFO theo lần duyệt còn hiệu lực; không tính lại phân bổ đã giữ chỗ |
| R5 | GIR B/D kiểm tồn khi Gửi duyệt/đồng ý/duyệt nhưng không giữ chỗ → nhiều GIR cùng đạt, GI sau thiếu (C79) | Đúng nghiệp vụ; UI hiển thị tổng đã đề nghị trên cùng phạm vi nguồn |
| R6 | Kiểm tồn B/D phải dùng **cùng phạm vi** (kho, HĐ nguồn, Sales nguồn) với FIFO khi GI, nếu không GIR được duyệt nhưng GI không lấy được lô | Một hàm domain duy nhất tính phạm vi nguồn, dùng chung cho GIR và GI |
| R7 | Backfill: lô cho GR Đã duyệt hiện có, Sales phụ trách cho HĐ cũ, phân bổ cho GI đã duyệt, `source_*` cho GIR `AVAILABLE_STOCK` cũ (chỉ có người phụ trách, không có HĐ nguồn) | Dữ liệu hiện là demo: đề xuất reset seed thay vì backfill; nếu backfill, GIR B/D cũ chưa `APPROVED` chuyển về `DRAFT` để chọn HĐ nguồn — cần xác nhận khi viết migration |
| R8 | Định nghĩa Sales nguồn khi lô cùng HĐ mang Sales khác nhau (CT17) quyết định khóa lọc lô và người đồng ý bước 1 | Chờ CT17; schema `source_owner_user_id` dùng được cho cả hai cách |
| R9 | `first_goods_receipt_id` chuyển sang GR sớm nhất khi Thu hồi cần `approved_at` còn hiệu lực trên GR; hai GR cùng dòng PR Thu hồi đồng thời | Khóa dòng PR (FOR UPDATE) trước khi tính lại; tie-break theo id |

## 6. Thứ tự triển khai đề xuất (sau review)
1. Sales phụ trách trên HĐ (CT5).
2. Liên kết dòng GIR → dòng PR, biểu diễn luồng A–D (CT6, CT10).
3. `received_quantity` dòng PO + tình trạng nhập PO; `first_goods_receipt_id` dòng PR.
4. `inventory_lots` + phân bổ GI FIFO + Thu hồi GR theo lô; test PostgreSQL thật.

## Hệ quả
- Tồn hết "dùng chung theo Kho + PN" ở mức xuất; màn tồn kho tổng vẫn đúng.
- GI không SN phức tạp hơn (phân bổ nhiều lô, bảng phân bổ).
- GR đầu tiên của dòng PR khó Thu hồi hơn khi có GIR hiệu lực.
