# ADR-0012: Dòng hàng bán, dòng vật tư và bốn luồng GIR

- **Trạng thái:** Đã chấp nhận — 2026-11-13 (bổ sung cùng ngày: đóng CM1–CM6; đóng CT1, CT2, CT9)
- **Sửa đổi:** ADR-0004 (thêm chiều người phụ trách nguồn hàng cho tồn kho), ADR-0009 (dòng PR/GIR tham chiếu `sales_contract_line_id`), ADR-0010 (phạm vi hạn mức; bước 1 của `AVAILABLE_STOCK`), 01 §3.4/§5/§6, 02 §A/§B/§C, 03 §1, §3, §5, §10.1.

## Bối cảnh
Ngoài hàng bán theo dòng HĐ, dự án còn mua và xuất **vật tư/phụ kiện triển khai hoặc dự phòng** cho HĐ. Các vật tư này không tương ứng với dòng HĐ nào. Ngoài ra, khi xuất trực tiếp từ tồn kho cần biết ai đang phụ trách nguồn hàng để xin đồng ý trước khi Quản lý kho duyệt.

Tài liệu này tách ba loại nội dung: **nghiệp vụ đã chốt**, **hiện trạng code đã xác minh** và **chưa chốt kỹ thuật**.

## 1. Nghiệp vụ đã chốt

### 1.1 Phân loại dòng
- PR và GIR gắn **một HĐ `ACTIVE` ở cấp chứng từ**.
- Mỗi dòng PR/GIR có **phân loại tường minh**: **hàng bán** hoặc **vật tư** (vật tư/phụ kiện triển khai, dự phòng) (CM4).
- MVP **không trộn** hàng bán và vật tư trong cùng một PR hoặc cùng một GIR (CM3).
- Dòng hàng bán bắt buộc `sales_contract_line_id`; dòng vật tư không bắt buộc.
- Trùng Product không đồng nghĩa trùng dòng HĐ. Hệ thống không tự suy ra, tự gán hoặc tự gộp dòng HĐ theo Product; không tự đổi phân loại dòng.

### 1.2 PR hàng bán (tạo từ HĐ)
- Từ màn hình HĐ, hệ thống copy toàn bộ dòng hàng và thông tin liên quan sang form PR; người dùng chỉnh sửa trước khi lưu.
- Mỗi dòng PR giữ đúng `sales_contract_line_id` của dòng HĐ gốc; không gộp các dòng HĐ cùng Product.
- Trong **cùng một PR**: không chia và không tạo trùng một dòng HĐ (tối đa một dòng PR cho mỗi dòng HĐ). **Nhiều PR khác nhau** được tham chiếu cùng dòng HĐ (CM6).

### 1.3 PR vật tư (tạo tại màn hình PR)
- Chọn HĐ, rồi tự chọn vật tư. Dòng vật tư không bắt buộc `sales_contract_line_id`.
- Được dùng mã tạm (`temporary_products`); tuân thủ quy tắc mapping/chuẩn hóa trước khi nhập kho (03 §1a: GRR không Gửi duyệt khi còn mã tạm) (CM5).

### 1.4 Bốn luồng GIR (CM1, CM2)
| Luồng | Phân loại | Nguồn | Quy tắc chính |
|---|---|---|---|
| A. Hàng bán theo PR | Hàng bán | Dòng PR thuộc PR đã `PO done` | Giữ riêng từng dòng PR; kiểm soát hạn mức dòng PR **và** hạn mức giao còn lại của dòng HĐ |
| B. Hàng bán trực tiếp | Hàng bán | `AVAILABLE_STOCK` | Không cần PR; bắt buộc dòng HĐ và Product được Sales xác nhận; kiểm soát hạn mức giao dòng HĐ |
| C. Vật tư theo PR | Vật tư | Dòng PR thuộc PR đã `PO done` | Giữ riêng từng dòng PR; kiểm soát hạn mức dòng PR; không áp hạn mức dòng HĐ |
| D. Vật tư trực tiếp | Vật tư | `AVAILABLE_STOCK` | Không cần PR hay dòng HĐ; vẫn gắn HĐ; **bắt buộc ghi mục đích sử dụng**; không áp hạn mức PR/HĐ |

- Hàng bán (A và B) **dùng chung hạn mức giao của dòng HĐ**, kể cả khi nhiều PR tham chiếu cùng dòng HĐ.
- **`PO done`** (đã chốt 2026-11-13, CT1): một PR đạt `PO done` khi **mọi dòng PR** có tổng số lượng trên các dòng PO `APPROVED` (còn hiệu lực theo workflow) **bằng đúng** số lượng yêu cầu của dòng đó. Một dòng PR có thể mua qua nhiều PO; cộng dồn theo tham chiếu dòng PR, không theo Product; tổng đặt mua không vượt số lượng dòng PR (§1). Thiếu bất kỳ dòng nào → chưa `PO done`. `PO done` quyết định PR có hiển thị khi lập GIR theo PR và là điều kiện Gửi duyệt GIR A/C (xem quy tắc mất `PO done`); không có nghĩa là đã nhập kho (CT1).
- **Mất `PO done`** (đã chốt 2026-11-13): `PO done` là **điều kiện để Gửi duyệt** GIR A/C, kiểm tra tại backend ở mỗi lần Gửi duyệt (GIR `DRAFT`, và GIR `REJECTED` sửa rồi Gửi duyệt lại), không chỉ khi hiển thị danh sách PR. PR không còn `PO done` → chặn Gửi duyệt. GIR **đã Gửi duyệt hợp lệ** không bị tự động Hủy, Thu hồi hay đổi trạng thái khi PR mất `PO done` sau đó; tiếp tục theo workflow và hạn mức hiện hữu (không hồi tố). PR đạt lại `PO done` → được Gửi duyệt.
- **Hạn mức GIR** (CT2, áp dụng cho dòng HĐ và dòng PR): `WAITING_FOR_APPROVE`, `REJECTED`, `APPROVED` chiếm; `DRAFT`, `CANCELED` không. Kiểm tra khi Gửi duyệt (kể cả `DRAFT` tạo trước) và Duyệt; sửa số lượng GIR `REJECTED` kiểm tra lại, không tính trùng chính nó; có kiểm soát đồng thời. GIR `COMPLETED` chỉ chiếm lượng thực xuất (ADR-0010); không cộng trùng GIR và GI. Thay thế quy tắc cũ "`DRAFT` chiếm hạn mức".
- **Luồng C** (CT9): mục đích sử dụng chỉ tham khảo, có thể kế thừa từ PR, không bắt buộc nhập lại, không là điều kiện hạn mức/duyệt. Luồng D vẫn bắt buộc ghi mục đích sử dụng.
- Luồng A/C phê duyệt một cấp (mặc định); duyệt hai bước chỉ áp dụng `AVAILABLE_STOCK` (B/D). Giá trị `issue_type` của A/C: chưa chốt (CT10).
- Luồng A/C hiển thị **lượng đã nhập thực tế** của từng dòng PR theo chuỗi dòng PR → PO → GRR → GR, cộng các GR hợp lệ (`APPROVED`); chưa nhập hiển thị 0. Không ghép theo Product. Lượng nhập **chỉ để tham khảo**, không dùng làm hạn mức GIR.
- Vật tư trực tiếp (D) dùng `AVAILABLE_STOCK`. Nguồn hàng (`AVAILABLE_STOCK`) và mục đích sử dụng (vật tư) là hai thông tin riêng.

### 1.5 Nguồn hàng và phê duyệt (luồng B/D)
- Chọn tồn theo thứ tự **Kho → Người phụ trách nguồn hàng → Product**.
- Một GIR chỉ lấy từ **một kho và một người phụ trách nguồn hàng**; được chọn nhiều Product của người đó. Kho hoặc người phụ trách khác → GIR khác.
- Duyệt hai bước: **người phụ trách nguồn hàng đồng ý → Quản lý kho duyệt**. Người phụ trách nguồn hàng có thể khác Sales của HĐ nhận hàng.
- Người phụ trách nguồn hàng được ghi nhận **khi duyệt GR**, thường là Sales phụ trách HĐ mà hàng được mua để phục vụ; không mặc định là Sales của HĐ nhận hàng.
- Tồn kho phải phân biệt lượng theo người phụ trách nguồn hàng, không chỉ theo Kho + Product.
- MVP không hỗ trợ nhiều kho trong một GIR hoặc nhóm kho.

### 1.6 Số lượng
Các con số sau là riêng biệt và không được dùng thay cho nhau: số lượng dòng HĐ, PR, PO, GR thực nhập, GIR đề nghị/được duyệt, GI thực xuất và tồn khả dụng. Tồn khả dụng được kiểm soát tại GI theo quy trình hiện có (03 §4).

### 1.7 Giữ nguyên
Phê duyệt một cấp cho các chứng từ khác, người tạo không tự duyệt, phạm vi kho, SN, Inventory chỉ biến động bởi GR/GI Đã duyệt, audit, mapping mã tạm (ADR-0008), đánh số/không xóa (ADR-0011), cờ `allow_available_stock_issue`.

## 2. Hiện trạng code đã xác minh (commit `6bd673e`)
- `purchase_requisition_lines.sales_contract_line_id` và `goods_issue_request_lines.sales_contract_line_id` là `NOT NULL`; không có cột phân loại dòng (`1731542400000-InboundChain.ts`, `1731628800000-OutboundChain.ts`).
- `goods_issue_request_lines` không có liên kết tới dòng PR; GIR `SALES_CONTRACT` hiện chọn trực tiếp dòng HĐ, không qua PR.
- Không có trạng thái, cột hay truy vấn nào biểu diễn `PO done`; Gửi duyệt GIR chưa kiểm tra `PO done` (GIR hiện chưa liên kết dòng PR). Có sẵn hạn mức Σ dòng PO (`WAITING_FOR_APPROVE` + `APPROVED`) ≤ dòng PR và truy vấn `usedQuantity` theo dòng PR (`modules/procurement/procurement.service.ts`) — có thể dựa vào để tính Σ PO `APPROVED` theo dòng PR, nhưng chưa có.
- Hạn mức GIR hiện tính mọi GIR `approval_status <> 'CANCELED'` (gồm `DRAFT`) và kiểm tra cả khi tạo/sửa (`modules/outbound/gir.service.ts`) — **lệch với CT2**, cần sửa khi implementation.
- `goods_issue_requests.issue_type` chỉ có `SALES_CONTRACT` / `AVAILABLE_STOCK` (CHECK constraint); `approval_step` chỉ dùng cho `AVAILABLE_STOCK`.
- Chuỗi truy vết dòng đã có: `purchase_order_lines.purchase_requisition_line_id` → `goods_receipt_request_lines.purchase_order_line_id` → `goods_receipt_lines.goods_receipt_request_line_id`.
- `inventories` duy nhất theo `(warehouse_id, product_id)`; `inventory_serials` và GR không lưu người phụ trách nguồn hàng.
- `sales_contracts` không có trường Sales phụ trách (chỉ `created_by`).
- Bước 1 `AVAILABLE_STOCK` giao cho người có quyền `GIR.SALES_CONFIRM` do người tạo chọn (IM15); chưa ràng buộc phải là người phụ trách nguồn hàng.
- Hạn mức dòng HĐ được khóa qua `SalesContractFacade.lockActiveLines` (`modules/outbound/gir.service.ts`).
Toàn bộ mục 1 **chưa được triển khai**.

## 3. Hệ quả
- Kiểm tra "dòng HĐ thuộc đúng HĐ của chứng từ" vẫn áp dụng cho dòng hàng bán (A34, C01).
- Luồng A/B khóa dòng HĐ (`pessimistic_write`); luồng A/C khóa thêm dòng PR khi kiểm tra hạn mức dòng PR. Thứ tự khóa đề xuất: ARCHITECTURE §2.1a.
- Lịch sử SN: nguồn xuất GIR → GI → HĐ vẫn đầy đủ vì HĐ gắn ở cấp chứng từ.
- ADR-0004 phải mở rộng chiều người phụ trách nguồn hàng; mô hình cụ thể chưa chốt.

## 4. Chưa chốt (OPEN-QUESTIONS §1)
Thiết kế `issue_type` cho luồng A/C (CT10); mô hình tồn kho theo người phụ trách và cơ chế phân bổ xuất theo dòng GR/lô; nguồn tồn của GI cho luồng A/C; cách xác định người phụ trách nguồn hàng mặc định khi duyệt GR; schema phân loại dòng và mục đích sử dụng. Không triển khai theo giả định.
