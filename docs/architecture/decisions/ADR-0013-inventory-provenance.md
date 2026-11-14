# ADR-0013: Tồn kho có nguồn gốc (HĐ nguồn / Sales phụ trách / GR) và GR tham chiếu trên dòng GIR

- **Trạng thái:** Nghiệp vụ **đã chốt** (2026-11-13/14; CT3, CT5, CT10–CT19). Thiết kế kỹ thuật §3–§6 **đề xuất, chờ review** — chưa có migration.
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
8. Lô giữ Sales phụ trách tại thời điểm Duyệt GR; bất biến (CT15).
9. GIR B/D: **một HĐ nguồn → một HĐ đích**, một Sales nguồn, một kho, nhiều Product (CT16). Lưu `DRAFT` khi chưa đủ tồn; bắt buộc đủ tồn khi Gửi duyệt; kiểm lại khi Sales nguồn đồng ý và Quản lý kho duyệt.
10. Sales phụ trách HĐ chỉnh khi `DRAFT`, khóa từ `ACTIVE`; Sales trên lô bất biến; HĐ nguồn B/D ≠ HĐ đích, không `CANCELED`, không bắt buộc `ACTIVE` (CT17–CT19).

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
  - **Triển khai theo giai đoạn (PR 3, 2026-11-14):** PR 3 tạo lô với `received_quantity` bất biến (không có `on_hand`/`reserved`), vì GI chưa phân bổ theo lô — duy trì số dư lô khi GI trừ tồn chưa phân bổ sẽ tạo sai lệch âm thầm. Đối soát PR 3: theo Kho + PN, `inventories.on_hand = Σ lô.received − Σ OUT` và `Σ lô.received = Σ IN từ GR` (`scripts/inventory-reconcile.sql`). PR 4 thêm `on_hand`/`reserved` theo lô cùng bảng phân bổ, backfill bằng FIFO cho GI đã duyệt, và chuyển đối soát sang `Σ lô.on_hand = inventories.on_hand`. Chưa thêm `inventory_transactions.inventory_lot_id` (cần khi GI phân bổ, PR 4).
  - **Đối soát (PR 3):** `RECONCILE_SQL` / `scripts/inventory-reconcile.sql` bao phủ mọi thao tác hiện đổi tồn — Duyệt GR (IN, lô, SN), Gửi duyệt GI (giữ chỗ), Từ chối/Thu hồi GI (giải phóng), Duyệt GI (OUT, SN) — ở ba mức: số dư (`ON_HAND`, `RESERVED`), dòng chứng từ (`GR_LINE`, `GI_LINE`), SN (`SERIALS`); biến động từ nguồn khác bị báo (`MOVEMENT_SOURCE`; chưa có nghiệp vụ điều chỉnh tồn). Migration dừng nếu có bất kỳ dòng nào. PR 4/PR 8 phải mở rộng truy vấn khi thêm phân bổ lô và Thu hồi GR.
  - **Phân bổ PXK (PR 4, 2026-11-14):** lô có `on_hand_quantity`/`reserved_quantity` (CHECK 0 ≤ giữ chỗ ≤ tồn ≤ nhập). `goods_issue_line_allocations` tạo khi **Gửi duyệt** GI: hàng không SN theo FIFO `(approved_at, id)` trong phạm vi nguồn; hàng có SN theo lô của SN đã chọn (ngoài phạm vi → `STOCK_OUT_OF_SCOPE`). **Duyệt** trừ đúng các lô đã phân bổ (không tính lại FIFO); **Từ chối/Thu hồi** giải phóng và xóa phân bổ; phân bổ của GI đã duyệt giữ vĩnh viễn làm vết xuất theo lô. Thứ tự khóa: `inventories` (product) → `inventory_lots` (`approved_at, id`) → `inventory_serials`; mọi đường ghi lô đều khóa `inventories` cùng PN trước nên GI đồng thời trên cùng PN được tuần tự hóa. `inventory_transactions` vẫn một dòng OUT / dòng GI (không thêm `inventory_lot_id`): vết theo lô nằm ở bảng phân bổ, tránh đổi unique chống ghi trùng.
  - **Phạm vi nguồn (PR 4, sửa 2026-11-14):** GI **kế thừa** nguồn từ GIR, người lập GI không chọn lại; **không bao giờ** nới về Kho + PN. `sourceScope(gir)` (`gi.service.ts`): GIR `SALES_CONTRACT` (mua HĐ nào xuất HĐ đó) → chỉ lô có HĐ nguồn = HĐ của GIR; GIR `AVAILABLE_STOCK` chưa lưu HĐ nguồn + Sales nguồn → **chặn Gửi duyệt GI** (`GIR_SOURCE_SCOPE_MISSING`) cho tới PR 7. Kho luôn là kho của GIR. Thiếu tồn trong phạm vi → `INSUFFICIENT_AVAILABLE_STOCK`; SN ngoài phạm vi → `STOCK_OUT_OF_SCOPE`.
  - **Đối soát (PR 4):** thêm `LOT` (tồn lô = nhập − phân bổ GI đã duyệt; giữ chỗ lô = phân bổ GI chờ duyệt), `ALLOCATION` (dòng GI chờ duyệt/đã duyệt phân bổ đủ, đúng kho + PN; dòng khác không có), `SERIAL_ALLOCATION` (phân bổ dòng SN khớp lô của SN); `ON_HAND`/`RESERVED` còn đối chiếu Σ lô. Migration backfill phát lại GI chờ duyệt/đã duyệt theo id với cùng quy tắc, dừng nếu đối soát lệch.
  - **Chạy lại migration / dữ liệu lịch sử:** `up` chạy trong một transaction — dừng (thiếu Sales, lệch đối soát) thì không để lại gì, sửa dữ liệu rồi chạy lại. `down` xóa bảng lô; `up` lần sau dựng lại lô từ GR Đã duyệt (lô không có dữ liệu riêng ngoài GR + HĐ, nên down/up không mất thông tin). Giới hạn: lô dựng lại lấy Sales **hiện tại** của HĐ nguồn — với HĐ cũ được gán qua runbook, đó là giá trị đã xác nhận chứ không phải "Sales lúc duyệt" (không có dữ liệu lịch sử). `down` không hủy `VALIDATE` CHECK PR 1 (vô hại).
- `goods_issue_requests` (B/D) thêm `source_sales_contract_id`, `source_owner_user_id` (NOT NULL khi `issue_type = AVAILABLE_STOCK`, CHECK). Phạm vi nguồn của GIR = (kho, HĐ nguồn, Sales nguồn) — mọi kiểm tồn và FIFO B/D lọc lô theo đúng bộ này (Sales nguồn = Sales ghi trên lô; do Sales HĐ khóa từ `ACTIVE`, bằng Sales của HĐ nguồn — vẫn lưu riêng để không phụ thuộc giả định này). CHECK `source_sales_contract_id <> sales_contract_id`; kiểm `status <> CANCELED` của HĐ nguồn ở application (khóa FOR SHARE dòng HĐ nguồn khi Gửi duyệt). A/C: phạm vi = (kho GI, HĐ của GIR), mọi Sales của lô.
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

**Quyết định triển khai (PR code #6, 2026-11-14): Q2 — tính khi đọc, thay đề xuất Q3.** `InboundFacade.firstReceipts` (Outbound → Inbound, một chiều, chỉ đọc) lấy GR `APPROVED` sớm nhất theo `(approved_at, id)` qua GR → GRR → dòng PO của dòng PR; lượng đã nhập = Σ `purchase_order_lines.received_quantity` của dòng PR (`ProcurementFacade.receivedByPrLine`, tái dùng tiến độ nhập PO). Không thêm cột, không migration. Lý do đổi: nghiệp vụ đã chốt "Thu hồi hợp lệ → chuyển sang GR còn hiệu lực sớm nhất" nên giá trị tính lại đúng bằng kết quả mong muốn; điều kiện "GR sau không ghi đè" được giữ vì GR sau luôn có `approved_at` muộn hơn. Khác biệt duy nhất so với lưu cột: GR bị Thu hồi rồi Duyệt lại nhận `approved_at` mới nên có thể không còn là GR đầu tiên — chấp nhận (GR đó đã không còn hiệu lực trong khoảng giữa). Đề xuất Q3 cũ (giữ để tham khảo): `purchase_requisition_lines.first_goods_receipt_id`; ghi bằng `UPDATE … WHERE first_goods_receipt_id IS NULL` trong transaction Duyệt GR, dưới khóa dòng PO. Kho suy ra từ GR. Không chạm bảng GIR.

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
| R8 | Hủy HĐ nguồn chạy đồng thời với Gửi duyệt GIR B/D mượn từ HĐ đó | Hủy HĐ khóa FOR UPDATE dòng HĐ; Gửi duyệt khóa FOR SHARE → tuần tự hóa. Thực tế HĐ có lô gần như không Hủy được (PR có PO) |
| R9 | `first_goods_receipt_id` chuyển sang GR sớm nhất khi Thu hồi cần `approved_at` còn hiệu lực trên GR; hai GR cùng dòng PR Thu hồi đồng thời | Khóa dòng PR (FOR UPDATE) trước khi tính lại; tie-break theo id |

## 6. Quyết định kỹ thuật bổ sung (tự chọn, 2026-11-14)
- **Dữ liệu cũ:** không backfill phức tạp. Migration lô tạo lô cho GR Đã duyệt hiện có, HĐ nguồn suy từ chuỗi PR, Sales = `sales_contracts.responsible_sales_user_id` (HĐ cũ: **NULL**, không mặc định người tạo — PR 1; lô của HĐ chưa có Sales cần xử lý ở PR 3); GI Đã duyệt cũ được phân bổ FIFO trong migration; GIR `AVAILABLE_STOCK` chưa `APPROVED` không có HĐ nguồn → chuyển `DRAFT` (ghi lịch sử). Môi trường demo được phép reset seed.
- `goods_receipts.approved_at` ghi lần duyệt còn hiệu lực (ghi đè khi duyệt lại); lô chụp `approved_at` này làm khóa FIFO, tie-break `id`.
- Phạm vi nguồn là một hàm domain thuần trong Inventory (`StockScope`: kho + product + HĐ nguồn? + Sales?) dùng cho cả GIR và GI; có unit test.
- Mã lỗi: `INSUFFICIENT_STOCK` (dùng lại), `GR_STOCK_IN_USE`, `GR_REFERENCED_BY_GIR`, `SOURCE_CONTRACT_INVALID`, `RESPONSIBLE_SALES_LOCKED`.

## 7. Kế hoạch triển khai — các PR code nhỏ
Mỗi PR: một migration (có `down`), test PostgreSQL thật tham chiếu ID 05, `pnpm test` + `pnpm build`, cập nhật OPEN-QUESTIONS §3.

| PR | Nội dung | Migration | Test chính |
|---|---|---|---|
| 1. Sales phụ trách HĐ | Cột, API/UI chọn Sales khi `DRAFT`, khóa khi `ACTIVE` | `sales_contracts.responsible_sales_user_id` nullable; CHECK `ACTIVE ⇒ NOT NULL` (`NOT VALID` cho HĐ cũ); HĐ cũ để NULL | C83–C83b |
| 2. Tiến độ nhập PO | `purchase_order_lines.received_quantity` cập nhật qua facade Procurement khi Duyệt GR; tình trạng nhập kho PO; `goods_receipts.approved_at` | Cột + backfill từ GR Đã duyệt | C68–C68b |
| 3. Lô tồn kho | `inventory_lots` ghi khi Duyệt GR (HĐ nguồn, Sales chụp từ HĐ, `approved_at`, `received_quantity`); `GET /inventories/lots`; migration chặn khi HĐ thiếu Sales, `VALIDATE` CHECK PR 1, dừng nếu không đối soát được | Bảng + backfill lô từ GR Đã duyệt | C71 — **chỉ phần nguồn nhập**; C72; đối soát đầy đủ; đồng thời |
| 4. Phân bổ GI FIFO | `goods_issue_line_allocations`; Gửi duyệt GI phân bổ + giữ chỗ lô; Duyệt trừ lô; Từ chối/Thu hồi giải phóng; GI hiện tại (chưa có nguồn A/C) dùng phạm vi Kho + PN tạm thời | Bảng + backfill GI cũ | C73; đồng thời 2 GI cùng lô |
| 5. Liên kết dòng GIR → dòng PR (A/C) | CT6/CT10: `goods_issue_request_lines.purchase_requisition_line_id`, biểu diễn luồng; GI A/C lọc theo HĐ nguồn | Cột, nới `sales_contract_line_id`; xử lý GIR `SALES_CONTRACT` cũ | C62, C69, C74 | *Đã làm (PR code #5): `PURCHASE_REQUISITION`, phân loại cấp chứng từ, hạn mức dòng PR, `PO done` khi Gửi duyệt.*
| 6. GR tham chiếu | `purchase_requisition_lines.first_goods_receipt_id` ghi khi Duyệt GR; hiển thị trên GIR | Cột + backfill | C63–C67 | *Đã làm (PR code #6): tính khi đọc (§4), không cột/migration; dòng GIR A/C trả `firstGoodsReceipt` + `receivedQuantity`.*
| 7. GIR B/D theo HĐ nguồn | `source_sales_contract_id`/`source_owner_user_id`, lọc lô, bước 1 giao Sales lô, lưu nháp khi thiếu tồn | Cột + CHECK; GIR B/D cũ → `DRAFT` | C70, C78, C84–C91, D13, D22 |
| 8. Thu hồi GR Đã duyệt | Điều kiện GIR tham chiếu + lô chưa đụng + SN; hoàn tác lô, tiến độ PO; chuyển GR tham chiếu | Không | B16–B26, C75–C77, C80–C82, C86, C87 |

Thứ tự phụ thuộc: 1 → 3; 2 → 6 → 8; 3 → 4 → (5, 7) → 8. PR 1 và 2 độc lập, làm song song được.

## Hệ quả
- Tồn hết "dùng chung theo Kho + PN" ở mức xuất; màn tồn kho tổng vẫn đúng.
- GI không SN phức tạp hơn (phân bổ nhiều lô, bảng phân bổ).
- GR đầu tiên của dòng PR khó Thu hồi hơn khi có GIR hiệu lực.
