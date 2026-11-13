# Mini ERP MVP — Phạm vi và thuật ngữ
**Trạng thái:** MVP baseline (2026-11-13). Thay đổi tiếp theo phải ghi nhận qua ADR/OPEN-QUESTIONS.

## 1. Mục tiêu
Quản lý hợp đồng bán hàng (HĐ) ở mức danh mục đơn giản; yêu cầu mua (PR); đơn đặt mua nhà cung cấp (PO); đề nghị nhập (GRR); phiếu nhập (GR); đề nghị xuất (GIR); phiếu xuất (GI); tồn kho và lịch sử serial.

## 2. Thuật ngữ
- **PN (Part Number):** mã hàng trong danh mục hàng hóa. Trong trao đổi trước có dùng từ SKU; từ đây thống nhất PN.
- **SN (Serial Number):** định danh một đơn vị hàng có quản lý serial.
- **HĐ:** hợp đồng **bán hàng cho khách**, không phải PO mua từ nhà cung cấp.
- **PR:** yêu cầu mua hàng để phục vụ một HĐ (gắn HĐ ở cấp chứng từ).
- **Dòng hàng bán / dòng vật tư (PR, GIR):** dòng hàng bán tham chiếu `sales_contract_line_id`; dòng vật tư (vật tư/phụ kiện triển khai, dự phòng) không tham chiếu dòng HĐ (ADR-0012).
- **PO:** đơn đặt mua từ **một** nhà cung cấp.
- **GRR / GR:** yêu cầu nhập / nhập kho thực tế.
- **GIR / GI:** yêu cầu xuất / xuất kho thực tế.
- **Tồn thực tế:** nhập đã duyệt trừ xuất đã duyệt.
- **Tồn khả dụng:** tồn thực tế trừ lượng giữ chỗ bởi GI Chờ duyệt.

## 3. Trong MVP
1. HĐ bán: trạng thái `DRAFT`/`ACTIVE`/`CANCELED`, do Sales tạo và chốt; không có duyệt HĐ riêng. Dòng HĐ lưu nguyên hàng hóa khách ký; Sales xác nhận các Product được phép giao cho từng dòng HĐ (PM đề xuất).
2. Danh mục hàng hóa (mã tạm, mã chính, cờ SN), khách hàng, nhà cung cấp, kho (có cờ cho phép xuất hàng có sẵn); phân quyền User → Role → Permission + kho được phép.
3. Sáu chứng từ PR, PO, GRR, GR, GIR, GI.
4. Hai loại GIR, **đều gắn HĐ ở cấp chứng từ** (dòng hàng bán tham chiếu dòng HĐ; dòng vật tư thì không — ADR-0012): **Xuất theo HĐ** (`SALES_CONTRACT`) và **Xuất hàng có sẵn trong kho** (`AVAILABLE_STOCK`, từ kho được cấu hình cho phép).
5. Một cấp phê duyệt (ngoại lệ: GIR `AVAILABLE_STOCK` hai bước Sales → Quản lý kho), người duyệt mặc định theo role/bước, thu hồi/từ chối/hủy theo điều kiện, thông báo trong ứng dụng.
5a. Số chứng từ tự sinh, bất biến; không xóa chứng từ, chỉ Hủy. File đính kèm và ghi chú cơ bản trên chứng từ.
6. Tồn kho báo cáo theo **Kho + PN**; tồn khả dụng phục vụ kiểm tra GI.
7. Tra cứu lịch sử SN, bao gồm nguồn nhập và nguồn xuất.
8. Tiến độ nhập trên PO (không hiển thị tiến độ xuất trên PO).
9. Chống vượt số lượng, xuất âm kho, nhập trùng SN và tranh chấp đồng thời.

## 4. Ngoài phạm vi MVP
Quy trình duyệt HĐ; phụ lục/điều chỉnh/versioning HĐ; điều chỉnh PO; quy đổi UoM; đánh số lại chứng từ; hệ thống quản lý tài liệu; phân quyền chi nhánh/phòng ban; kế toán, công nợ, thanh toán; chuyển kho; tồn theo vị trí; quy trình bảo hành/đổi trả; báo cáo phân tích/dashboard riêng; tích hợp hệ thống ngoài.

## 5. Quan hệ nền tảng
- **Một HĐ có nhiều PR; một PR thuộc đúng một HĐ.**
- Một PO có thể gom dòng từ nhiều PR (kể cả HĐ khác nhau), nhưng chỉ có một nhà cung cấp.
- Một PO có nhiều GRR; một GRR có tối đa một GR chưa Hủy.
- Một GIR có nhiều GI.
- Một dòng HĐ có nhiều dòng PR hàng bán (`sales_contract_line_id`), nhiều dòng GIR hàng bán (hạn mức theo dòng HĐ) và nhiều Product được Sales xác nhận cho phép giao.
- Dòng vật tư trên PR/GIR chỉ gắn HĐ qua chứng từ, không gắn dòng HĐ. Trùng Product không đồng nghĩa trùng dòng HĐ; không tự suy ra dòng HĐ từ Product (ADR-0012).
- Cả hai loại GIR đều thuộc một HĐ `ACTIVE` (cấp chứng từ).
- Hàng vật lý tại một kho được dùng chung theo PN, kể cả khi được mua cho HĐ/khách hàng khác.

## 6. Nguyên tắc đặc tả
Các quyết định về GIR **chọn dòng PO và giữ hạn mức PO/PR** thuộc mô hình cũ, **không còn được áp dụng nguyên xi** cho hai loại GIR mới. Những điểm chưa xác nhận được ghi trong mục 'Cần làm rõ', không được âm thầm coi là đã chốt.


## Quy ước tên chứng từ và CSDL (đã xác nhận)
| Tên Việt | Tên tiếng Anh | Mã | Bảng chính | Bảng dòng |
|---|---|---|---|---|
| Yêu cầu mua hàng | Purchase Requisition | PR | `purchase_requisitions` | `purchase_requisition_lines` |
| Đơn đặt mua hàng | Purchase Order | PO | `purchase_orders` | `purchase_order_lines` |
| Đề nghị nhập kho | Goods Receipt Request | GRR | `goods_receipt_requests` | `goods_receipt_request_lines` |
| Phiếu nhập kho | Goods Receipt | GR | `goods_receipts` | `goods_receipt_lines` |
| Đề nghị xuất kho | Goods Issue Request | GIR | `goods_issue_requests` | `goods_issue_request_lines` |
| Phiếu xuất kho | Goods Issue | GI | `goods_issues` | `goods_issue_lines` |

Danh mục: `sales_contracts`, `sales_contract_lines`, `products` (PN: `part_number`, cờ SN: `is_serial_tracked`), `customers`, `suppliers`, `warehouses`, `users`. Chi tiết GR: `goods_receipt_details`; SN xuất GI: `goods_issue_serials`.

**Danh mục hàng hóa** (tên trên giao diện) gồm hai bảng tách biệt (đã chốt 2026-11-13):
- `temporary_products` — **mã tạm**: mã, tên, mô tả; không có đơn vị tính (UoM).
- `products` — **mã chính (PN)**: mã chính, UoM, cờ SN `is_serial_tracked`, thông tin kế toán dự trù (chỉ lưu, không có nghiệp vụ kế toán trong MVP).
Dòng PR (`purchase_requisition_lines`) lưu snapshot mã, tên, mô tả, UoM ban đầu và `product_id` nullable là kết quả chuẩn hóa dùng chung (xem 03 §1a).

Quy ước: bảng/cột tiếng Anh `snake_case`, bảng số nhiều; khóa chính `id`, khóa ngoại `<entity>_id`; mã chứng từ hiển thị `document_number` tách khỏi khóa chính; trạng thái duyệt `approval_status`; số lượng `quantity` (nguyên khi đơn vị hàng được quản lý theo số nguyên). Hai loại GIR dùng chung bảng `goods_issue_requests` với `issue_type` là `SALES_CONTRACT` hoặc `AVAILABLE_STOCK`.

*Lưu ý:* Đây là quy ước đặt tên và mô hình dữ liệu mức nghiệp vụ, **không phải thiết kế schema hoàn chỉnh**. Các trường, ràng buộc và chỉ mục còn được đặc tả khi triển khai.
