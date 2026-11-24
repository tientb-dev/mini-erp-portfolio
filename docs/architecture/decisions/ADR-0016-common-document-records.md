# ADR-0016 — Ghi chú và lịch sử hoạt động dùng chung

## Quyết định

- Ghi chú dùng bảng `document_notes` với cặp `target_type + target_id`. Lịch sử hoạt động tiếp tục dùng `approval_histories` với cặp tương đương `document_type + document_id`. ID là khóa nội bộ. Bảng lịch sử giữ actor, hành động, thời gian, trạng thái trước/sau, vòng, lý do và metadata JSON.
- Module sở hữu chứng từ xác thực loại đích, sự tồn tại và phạm vi quyền trước khi dùng module document records. Danh sách loại đích có allowlist và ràng buộc database. Quan hệ đa hình kiểm tra ở module sở hữu, do PostgreSQL không có một FK thông thường tới nhiều bảng. Vòng đời chứng từ hiện tại dùng hủy mềm.
- Người xem được PR thì được xem và thêm ghi chú, kể cả PR Hoàn tất. Kiểm tra quyền và ghi trong một transaction. Lịch sử được ghi cùng transaction với action workflow.
- Activity append-only. PostgreSQL chặn UPDATE, DELETE và TRUNCATE. Tác vụ quản trị test duy nhất có thể tạm ngưng trigger trong transaction sau khi kiểm tra môi trường và phụ thuộc.
- PR đọc ghi chú và lịch sử mới nhất trước theo ID giảm dần, 25 bản ghi/trang, lấy trang kế tiếp theo cursor `before`. Các API lịch sử PO/kho hiện có tiếp tục giữ thứ tự và hình thức đọc đã được caller sử dụng.
- State vận hành, assignment và snapshot vòng vẫn lưu tại workflow. Metadata lịch sử mô tả sự kiện và bổ sung chi tiết truy vết.

## Migration Phase 1

Migration bổ sung chuyển ghi chú PR sang bảng chung, giữ ID, nội dung, tác giả và thời gian, cập nhật sequence và giữ nguyên các hàng lịch sử. Thực hiện migration trên database đã có workflow PR mà không cần reset. Rollback được chặn khi có dữ liệu không biểu diễn được bằng schema trước. Script reset PR riêng chỉ chạy trên `mini_erp_test` cục bộ, từ chối khi PO/GIR còn tham chiếu; giữ dữ liệu hệ thống và các chứng từ khác.
