# Mini ERP MVP — Phân quyền, duyệt và thông báo
**Trạng thái:** MVP baseline (2026-11-13). Thay đổi tiếp theo phải ghi nhận qua ADR/OPEN-QUESTIONS.

## 1. Nguyên tắc
- Ưu tiên workflow thông suốt; không phân quyền chi nhánh/phòng ban phức tạp.
- **User → Role → Permission** kết hợp danh sách kho được phép (`user_warehouses`). Không có role khác nhau theo từng kho.
- **Một cấp phê duyệt** là mặc định. **Ngoại lệ duy nhất:** GIR `AVAILABLE_STOCK` có hai bước duyệt tuần tự (Sales → Quản lý kho). Các chứng từ khác không chuyển sang hai cấp.
- Người tạo không được tự duyệt.
- Quyền duyệt theo loại chứng từ (permission); chứng từ kho còn giới hạn theo `user_warehouses`.
- Người duyệt được phê duyệt/từ chối, không được sửa dữ liệu chứng từ.
- Người tạo quản lý chứng từ của mình (tạo, sửa Nháp/Bị từ chối, Gửi duyệt, Thu hồi, Hủy khi đủ điều kiện).
- Ngoại lệ: người được cấp quyền **khai báo chi tiết GR** tại kho có thể sửa chi tiết GR Nháp/Bị từ chối dù không phải người tạo; chỉ người tạo Gửi duyệt/Thu hồi/Hủy.
- Thu hồi GR Đã duyệt và Hủy GR do người tạo thực hiện, trong phạm vi kho, khi thỏa điều kiện 03 §2.1–2.2; người duyệt trước đó nhận thông báo kèm lý do (mục 5); không có người nhận thông báo bổ sung.
- Quyền xem đầy đủ chứng từ theo loại (+ kho với chứng từ kho), độc lập quyền duyệt; người tạo luôn xem được chứng từ của mình.
- Quyền xem tồn kho theo kho trong `user_warehouses`. Người xử lý GI không có quyền xem tồn đầy đủ vẫn có thể thấy số khả dụng và SN đủ điều kiện phục vụ phiếu.
- Người dùng phải thấy được chứng từ cần mình xử lý; khi không đủ quyền thao tác, UI nêu lý do rõ ràng.

## 2. Vai trò nghiệp vụ chính
| Vai trò | Trách nhiệm |
|---|---|
| Sales | Tạo, sửa, chốt (`ACTIVE`), hủy HĐ; xem tất cả HĐ (chưa phân quyền xem theo khách hàng); xác nhận/từ chối Product được phép giao cho dòng HĐ; bước duyệt 1 của GIR `AVAILABLE_STOCK` |
| PM | Tạo GIR; đề xuất Product thay thế cho dòng HĐ kèm lý do; không tự xác nhận thay Sales |
| Quản lý kho | Phụ trách GI; duyệt GIR (bước cuối với `AVAILABLE_STOCK`); "Xác nhận hoàn thành xuất" GIR |
Phân công duyệt các loại chứng từ khác giữ nguyên theo tài liệu này. Dòng hàng bán / dòng vật tư (ADR-0012) không thêm vai trò, mã quyền hay bước duyệt mới; quyền tạo/sửa/duyệt PR, GIR và phạm vi kho áp dụng như nhau cho hai loại dòng.

## 3. Người duyệt mặc định
- Hệ thống tự điền người duyệt theo role/bước duyệt; có dropdown cho chọn người khác đủ điều kiện.
- Người duyệt mặc định cấu hình theo role hoặc bước duyệt, không dùng một flag chung cho mọi nghiệp vụ.
- Không có mặc định và có nhiều người hợp lệ → người tạo phải chọn.
- Backend kiểm tra quyền của người được chọn khi Gửi duyệt.
- Không xác định được duy nhất một người mặc định (kể cả khi nhiều kho tham gia) → người tạo chọn từ dropdown người hợp lệ.
- **Người được giao duyệt (assigned approver)**: chỉ người này thấy chứng từ trong "Chờ tôi duyệt", nhận thông báo và được Duyệt/Từ chối — kiểm tra ở mức dữ liệu ngoài permission `FUNCTION.ACTION`.

## 4. Danh sách
- **Chờ tôi duyệt:** chứng từ Chờ duyệt (ở bước hiện tại) mà người dùng là người được giao duyệt và không phải người tạo.
- **Chứng từ của tôi:** tất cả chứng từ do người dùng tạo.
- Người xem chứng từ cha được thấy tóm tắt chứng từ con (mã, trạng thái, số lượng/tiến độ), nhưng mở toàn bộ con cần quyền xem hoặc là người tạo.
- Thông tin tên/mã khách hàng trên liên kết được phép hiển thị mà không đồng nghĩa quyền mở PR/HĐ đầy đủ.

## 5. SN và GR
- Người khai báo kho xem chi tiết GR trong kho ở mọi trạng thái, chỉ chỉnh chi tiết Nháp/Bị từ chối.
- SN lịch sử chỉ tìm thấy khi SN thuộc phạm vi kho được cấp quyền xem tồn; không tiết lộ sự tồn tại của SN ngoài quyền.
- Lịch sử có thể cho xem chuỗi tham chiếu chứng từ, nhưng mở toàn bộ chứng từ cần quyền tương ứng.
- Ghi nhận người chỉnh sửa cuối và thời điểm trên chi tiết GR; không yêu cầu audit diff từng ô.

## 6. Thông báo trong ứng dụng
- Gửi duyệt → người được giao duyệt của bước hiện tại (GIR `AVAILABLE_STOCK`: Sales, sau đó Quản lý kho).
- Duyệt/Từ chối → người tạo (GIR: PM tạo GIR).
- Thu hồi khi Chờ duyệt → không gửi thông báo mới.
- Thu hồi/Hủy chứng từ Đã duyệt → thông báo người duyệt trước đó kèm lý do.
- Hủy Nháp/Bị từ chối → không thông báo.
- Thông báo cũ không xóa khi chứng từ đổi trạng thái.
- Đọc/chưa đọc độc lập trạng thái chứng từ; mở thông báo đánh dấu đã đọc; có đánh dấu tất cả đã đọc.

## Quy ước thuật ngữ và tên bảng
PR = Purchase Requisition (`purchase_requisitions`); PO = Purchase Order (`purchase_orders`); GRR = Goods Receipt Request (`goods_receipt_requests`); GR = Goods Receipt (`goods_receipts`); GIR = Goods Issue Request (`goods_issue_requests`); GI = Goods Issue (`goods_issues`). Các bảng dòng dùng hậu tố `_lines`. Tham chiếu chi tiết xem `01-MVP-SCOPE.md`.
