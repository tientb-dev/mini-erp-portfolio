# Hướng dẫn làm việc trong Mini ERP

- Đọc `CLAUDE.md`, sau đó đối chiếu yêu cầu với `docs/02-BUSINESS-FLOWS.md`, `docs/03-BUSINESS-RULES.md`, `docs/04-PERMISSIONS.md` và ADR áp dụng. Với UI, đọc `docs/architecture/FRONTEND.md`. Ghi rõ điểm mâu thuẫn trước khi thay đổi quy tắc.
- Giữ module sở hữu chứng từ chịu trách nhiệm kiểm tra tồn tại, quyền và trạng thái. Giao tiếp qua facade; ưu tiên dùng lại các thành phần workflow, ghi chú và lịch sử chung. Organization và Authorization độc lập.
- Ưu tiên kiến trúc đích nhất quán. Không xây backward compatibility cho dữ liệu thử nghiệm, duy trì song song schema/API/permission/logic, hoặc thêm fallback, adapter, auto-mapping hay backfill chỉ để giữ dữ liệu cũ.
- Reset Dev/Test DB và kho dữ liệu nghiệp vụ tương ứng khi BA phê duyệt, sau khi xác minh môi trường, instance, database, storage và quan hệ phụ thuộc. Fixture phá hủy chỉ chạy trên PostgreSQL Test đã xác minh. Dev chỉ seed dữ liệu nền.
- Giữ thay đổi dữ liệu nghiệp vụ trong transaction. Bảo đảm migration, rollback, audit và tính toàn vẹn theo kiến trúc đích.
- Kiểm thử phía API và UI theo phạm vi thay đổi, gồm hồi quy các chứng từ liên quan. Chạy build và kiểm tra diff. Báo kết quả thực tế, các phần trì hoãn và giới hạn kiểm chứng.
- Với PR thay đổi UI/UX, kiểm tra trình duyệt thật và visual evidence trước/sau theo UI-EVIDENCE-001 trong `docs/architecture/FRONTEND.md`.
- Screenshot bàn giao: lưu tại `docs/screenshots/<phase>/` (ví dụ `docs/screenshots/oa2.2/`); tên file có số thứ tự và nội dung màn hình (`01-tree-detail.png`); viewport chuẩn 1366×768; báo cáo bằng đường dẫn tương đối từ repo root. Không bàn giao ảnh qua thư mục Temp hoặc `.playwright-mcp/`.
- Với nút thao tác nghiệp vụ, dùng [COMMON-BUTTON-001](docs/architecture/FRONTEND.md#common-button-001).
- Trước khi tạo hoặc sửa màn hình và khi nghiệm thu, đối chiếu [COMMON-UI-CHECKLIST-001](docs/architecture/FRONTEND.md#common-ui-checklist-001); sửa ở Common component và FRONTEND.md trước khi thêm style riêng cho một màn hình.
- Bám phạm vi đợt đang làm. Thực hiện commit, push, PR hoặc merge theo phạm vi đã được người dùng cho phép.
