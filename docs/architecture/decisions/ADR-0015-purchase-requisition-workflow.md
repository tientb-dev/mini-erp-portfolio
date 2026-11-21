# ADR-0015 — Phê duyệt và tiếp nhận Đề nghị mua hàng

- **Trạng thái:** Đã chốt trong PR #18.
- **Phạm vi:** PR hàng bán và PR vật tư. Thay thế workflow một cấp của PR trong ADR-0007 và bổ sung phạm vi xem của ADR-0014.

## Trạng thái và phân công

- `DRAFT → WAITING_FOR_APPROVE → WAITING_FOR_RECEIPT → DONE`. `APPROVED` là kết quả của bước. `REJECTED` cho phép sửa và gửi lại.
- Sales hoặc PM có `PR.CREATE` chỉ tạo PR cho HĐ mà mình phụ trách. HĐ dùng trường Sales hiện có và thêm một PM tùy chọn. Nếu cùng phụ trách theo cả hai vai trò, người tạo chọn luồng.
- Sales Head xử lý luồng Sales, PM Head xử lý luồng PM. Purchasing tiếp nhận ban đầu. Cấu hình nhận gồm role và người dùng, hỗ trợ chuyển bộ phận bằng cách cấu hình role có `PR.RECEIVE`.
- Mỗi lần gửi, hệ thống xác thực người được giao còn hoạt động, đúng role, có permission và khác người tạo. Phân công và bộ phận được lưu theo vòng. Mỗi quyết định yêu cầu đúng bước, đúng người được phân công và quyền tương ứng. Sửa cấu hình có hiệu lực từ lần gửi tiếp theo.
- Người tạo thu hồi ở hai trạng thái chờ, nhập lý do, quay về Nháp và vô hiệu hóa các bước của vòng đã thu hồi. Gửi lại mở vòng mới. Hai bước đều cho từ chối và bắt buộc lý do.
- Người tạo được hủy Nháp hoặc Bị từ chối. Với PR Hoàn tất, hủy yêu cầu lý do và không còn PO chưa hủy. PR Hoàn tất không thể thu hồi.
- PO chỉ lấy dòng PR Hoàn tất. GIR A/C giữ quy tắc `PO done` dựa trên tổng số lượng của PO đã duyệt cho từng dòng. GRR/GR tiếp tục kiểm tra trạng thái của chứng từ nguồn trực tiếp.

## Xem chứng từ, ghi chú và thông báo

- `PR.VIEW` giữ phạm vi xem đầy đủ. Người có quyền tạo, duyệt hoặc tiếp nhận được mở danh sách giới hạn theo vai trò trong chứng từ hoặc HĐ. Quyền chỉ xem của Sales phụ trách HĐ theo ADR-0014 vẫn áp dụng. API con `/:id/lines` vẫn yêu cầu `PR.VIEW`.
- Ghi chú lưu nội dung, người gửi và thời điểm. Xem lịch sử theo quyền xem PR. Lịch sử ghi vòng, hành động, trạng thái trước và sau, người thao tác và lý do. Kết quả bước đã hết hiệu lực vẫn lưu trong vòng cũ.
- Thông báo trong ứng dụng được ghi cùng transaction đổi trạng thái. Thu hồi thông báo cho cả người duyệt và người tiếp nhận của vòng đó. Đọc/chưa đọc độc lập với trạng thái PR.

## Cấu hình và triển khai

Cấu hình qua OpenAPI bằng người dùng có `PR.CONFIGURE` (seed cấp cho ADMIN):

- `PUT /pr-workflow/routes/SALES` và `PUT /pr-workflow/routes/PM` nhận `approverId`, `receiverId`, `receiptRole` (ban đầu là `PURCHASING`). `GET /pr-workflow/routes` xem lại cấu hình.
- `PUT /pr-workflow/contracts/:id/responsible-pm` nhận `userId` của một PM đang hoạt động.
- `GET /pr-workflow/candidates` liệt kê người dùng hợp lệ theo role và permission.
- Thiếu phân công vẫn lưu được Nháp. Gửi duyệt báo cấu hình cần bổ sung. Seed role không tự gán người phụ trách hay người duyệt. Demo seed dùng cấu hình Sales đã thiết lập.

Migration schema yêu cầu bảng PR rỗng. Với dữ liệu cũ, dùng script reset trước migration trên môi trường Compose development/test đã xác nhận, theo README. Script giữ HĐ, dữ liệu danh mục, người dùng, phân quyền, cấu hình và bộ đếm chứng từ. Trạng thái và lịch sử chứng từ cũ thuộc phạm vi reset.
