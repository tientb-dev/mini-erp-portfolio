# ADR-0015 — Phê duyệt và tiếp nhận Đề nghị mua hàng

- **Trạng thái:** Đã chốt trong PR #18.
- **Phạm vi:** PR hàng bán và PR vật tư. Thay thế workflow một cấp của PR trong ADR-0007 và bổ sung phạm vi xem của ADR-0014.

## Trạng thái và phân công

- `DRAFT → WAITING_FOR_APPROVE → WAITING_FOR_RECEIPT → DONE`. `APPROVED` là kết quả của bước. `REJECTED` cho phép sửa và gửi lại.
- Sales hoặc PM có `PR.CREATE` chỉ tạo PR cho HĐ mà mình phụ trách. HĐ dùng trường Sales hiện có và thêm một PM tùy chọn. Nếu cùng phụ trách theo cả hai vai trò, người tạo chọn luồng.
- Admin cấu hình tập người phê duyệt cho Sales và PM, cùng một tập người tiếp nhận. Tư cách ứng viên dựa trên thành viên tập và permission hiện hành trong RBAC. Tài khoản được gán theo hợp đồng với `PR.CREATE` có phạm vi tạo PR; tên role do cấu hình quyết định.
- Người tạo có thể lưu lựa chọn ở Nháp hoặc chọn lại khi Gửi duyệt. Submit lưu snapshot người xử lý và tên vai trò cấp quyền theo vòng. Action xử lý kiểm tra lại assignment, tư cách ứng viên, tài khoản hoạt động và permission trong transaction. Thu hồi eligibility tác động ngay sau commit, giữ nguyên phân công và trạng thái PR.
- Người tạo thu hồi ở hai trạng thái chờ, nhập lý do, quay về Nháp và vô hiệu hóa các bước của vòng đã thu hồi. Gửi lại mở vòng mới. Hai bước đều cho từ chối và bắt buộc lý do.
- Người tạo được hủy Nháp hoặc Bị từ chối. Với PR Hoàn tất, hủy yêu cầu lý do và không còn PO chưa hủy. PR Hoàn tất không thể thu hồi.
- PO chỉ lấy dòng PR Hoàn tất. GIR A/C giữ quy tắc `PO done` dựa trên tổng số lượng của PO đã duyệt cho từng dòng. GRR/GR tiếp tục kiểm tra trạng thái của chứng từ nguồn trực tiếp.

## Xem chứng từ, ghi chú và thông báo

- `PR.VIEW` giữ phạm vi xem đầy đủ. Người có quyền tạo, duyệt hoặc tiếp nhận được mở danh sách giới hạn theo vai trò trong chứng từ hoặc HĐ. Quyền chỉ xem của Sales phụ trách HĐ theo ADR-0014 vẫn áp dụng. API con `/:id/lines` vẫn yêu cầu `PR.VIEW`.
- Ghi chú lưu nội dung, người gửi và thời điểm. Xem lịch sử theo quyền xem PR. Lịch sử ghi vòng, hành động, trạng thái trước và sau, người thao tác và lý do. Kết quả bước đã hết hiệu lực vẫn lưu trong vòng cũ.
- Thông báo trong ứng dụng được ghi cùng transaction workflow. Submit/Resubmit giao việc phê duyệt. Approve báo kết quả cho creator và giao việc tiếp nhận. Receive và Reject báo kết quả cho creator, Reject kèm lý do. Recall đóng công việc và thông báo cho người đang được phân công bước hiện tại.
- Task thông báo có bước xử lý và thời điểm kết thúc, độc lập với đã đọc/chưa đọc. Mỗi PR có tối đa một task đang mở. Quyết định/Recall/Reassign đóng task cũ trong transaction; chuyển bước hoặc Reassign giao task mới. Chuông giữ sự kiện và task đã đóng để tra cứu, badge chỉ tính thông báo chưa đọc còn hiệu lực.

## Cấu hình và triển khai

Cấu hình qua OpenAPI bằng người dùng có `PR.CONFIGURE` (seed cấp cho ADMIN):

- `PUT /pr-workflow/routes/{SALES|PM|RECEIPT}` nhận `{ "userIds": [...] }` và thay toàn bộ tập tương ứng. Danh sách rỗng thu hồi toàn bộ ứng viên của tập đó. `GET /pr-workflow/routes` trả thành viên theo tập.
- `PUT /pr-workflow/contracts/:id/responsible-pm` nhận `userId` của một PM đang hoạt động.
- `GET /pr-workflow/candidates` trả danh sách người có quyền cho Admin cấu hình từng tập. Creator có `PR.CREATE` dùng `GET /pr-workflow/creator-candidates?salesContractId=…&route=…` khi tạo hoặc `GET /purchase-requisitions/:id/candidates` khi sửa/gửi PR. Backend giới hạn theo hợp đồng/creator, trả người còn hoạt động và bỏ chính creator.
- Gửi duyệt cần `approverId`, `receiverId` và ngữ cảnh `version`, `round`, `step`. `approve` xử lý bước `APPROVAL`, `receive` xử lý bước `RECEIPT`. Reject/Recall/Cancel cũng yêu cầu ngữ cảnh. Trạng thái Nháp/Bị từ chối dùng `CREATE`, Hoàn tất/Hủy dùng `CLOSED`. Khi ngữ cảnh cũ, API trả `409 STALE_WORKFLOW_CONTEXT`.
- Migration Phase 2 chuyển approver cũ vào tập Sales/PM tương ứng và hợp nhất receiver cũ vào tập tiếp nhận chung. Snapshot cũ giữ nguyên. Không hỗ trợ downgrade làm mất dữ liệu từ tập nhiều người về một cặp. Demo seed dùng các tập Sales và Receipt đã cấu hình.
- Phase 3 thêm `GET /purchase-requisitions/:id/reassignment-candidates` và `POST /purchase-requisitions/:id/reassign`. Body Reassign gồm `version`, `round`, `step`, `assigneeId`, `reason`. Danh sách người thay thế loại creator và người hiện tại. `PR.REASSIGN` dùng cùng phạm vi đọc PR hiện có, không tự mở rộng phạm vi chứng từ.
- Migration thông báo chuyển các bản ghi giao việc cũ thành task đúng bước và giữ tối đa task mới nhất khớp người xử lý/bước/vòng hiện tại. Bản ghi cũ được giữ lại.

Migration schema workflow đầu tiên yêu cầu bảng PR rỗng. Migration bổ sung của Phase 1 bảo toàn PR và lịch sử hiện có, theo [ADR-0016](ADR-0016-common-document-records.md). Script reset riêng chỉ dành cho PR test và từ chối xóa khi PO/GIR còn tham chiếu.

## Quyết định UAT cho các phase tiếp theo

- Admin cấu hình tập đủ điều kiện, creator chọn người khi Gửi duyệt. Kiểm tra eligibility hiện hành khi hành động. Thu hồi eligibility có hiệu lực ngay với cả người đã được phân công.
- Một người có thể vừa phê duyệt vừa tiếp nhận nếu đủ điều kiện ở từng bước. Creator không được xử lý PR của mình.
- `PR.CONFIGURE` quản lý cấu hình. `PR.REASSIGN` độc lập cho quyền phân công lại của Admin. Giữ các quyền của creator và người tiếp nhận hiện tại theo ma trận UAT.
- Reassign chỉ tác động node đang chờ, có lý do, giữ nguyên trạng thái và vòng. Cập nhật assignment, hàng đợi, activity và thông báo cho người cũ/mới cùng transaction.
- Action phải mang ý định tường minh, version, round và step. Backend kiểm tra lại dưới khóa trong transaction. Tổ chức, quyền và phân công đổi qua cấu hình. Role trong card dùng nhãn **Vai trò**.
- Phase 1 bổ sung permission và lưu trữ chung. Phase 2 triển khai Eligibility và kiểm soát ngữ cảnh action. Phase 3 triển khai Reassign và thông báo theo loại công việc/sự kiện.
