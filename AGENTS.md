# Hướng dẫn làm việc trong Mini ERP

- Đọc `CLAUDE.md`, sau đó đối chiếu yêu cầu với `docs/02-BUSINESS-FLOWS.md`, `docs/03-BUSINESS-RULES.md`, `docs/04-PERMISSIONS.md` và ADR áp dụng. Với UI, đọc `docs/architecture/FRONTEND.md`. Ghi rõ điểm mâu thuẫn trước khi thay đổi quy tắc.
- Giữ module sở hữu chứng từ chịu trách nhiệm kiểm tra tồn tại, quyền và trạng thái. Giao tiếp qua facade; ưu tiên dùng lại các thành phần workflow, ghi chú và lịch sử chung. Organization và Authorization độc lập.
- Giữ thay đổi dữ liệu nghiệp vụ trong transaction, có migration rõ ràng. Kiểm tra quan hệ phụ thuộc và đích kết nối trước khi chạy thao tác phá hủy. Chỉ chạy fixture phá hủy trên PostgreSQL test đã xác minh.
- Kiểm thử phía API và UI theo phạm vi thay đổi, gồm hồi quy các chứng từ liên quan. Chạy build và kiểm tra diff. Báo kết quả thực tế, các phần trì hoãn và giới hạn kiểm chứng.
- Với PR thay đổi UI/UX, kiểm tra trình duyệt thật và visual evidence trước/sau theo UI-EVIDENCE-001 trong `docs/architecture/FRONTEND.md`.
- Với nút thao tác nghiệp vụ, dùng [COMMON-BUTTON-001](docs/architecture/FRONTEND.md#common-button-001).
- Trước khi tạo hoặc sửa màn hình và khi nghiệm thu, đối chiếu [COMMON-UI-CHECKLIST-001](docs/architecture/FRONTEND.md#common-ui-checklist-001); sửa ở Common component và FRONTEND.md trước khi thêm style riêng cho một màn hình.
- Bám phạm vi đợt đang làm. Thực hiện commit, push, PR hoặc merge theo phạm vi đã được người dùng cho phép.
