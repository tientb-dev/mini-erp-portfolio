# ADR-0010: GIR — hạn mức dòng HĐ, duyệt hai bước `AVAILABLE_STOCK`, hoàn thành xuất, thu hồi

- **Trạng thái:** Đã chấp nhận — 2026-11-13
- **Đóng:** U1, U3, U6, U8, W1 (một phần), W2 (phần GIR)

## Hạn mức
- Hạn mức theo `sales_contract_line_id` (chỉ dòng hàng bán; dòng vật tư không chiếm — ADR-0012). GIR `DRAFT`/`WAITING_FOR_APPROVE`/`APPROVED`/`REJECTED` chiếm hạn mức; `CANCELED` không; `COMPLETED` chỉ chiếm lượng thực xuất (Σ GI `APPROVED`).
- Kiểm tra khi tạo/sửa/Gửi duyệt/Duyệt GIR, trong transaction **khóa dòng HĐ** (`pessimistic_write`, qua facade Sales Contracts). Mọi thao tác thay đổi lượng chiếm hạn mức (kể cả Hủy GIR, hoàn thành xuất) đi qua cùng điểm khóa.
- Cách lưu lượng chiếm hạn mức (tổng hợp trên dòng HĐ hay tính bằng truy vấn) quyết định ở ERD; nếu dùng số tổng hợp thì cập nhật cùng transaction như ADR-0003.
- `AVAILABLE_STOCK`: thêm điều kiện ≤ tồn khả dụng (đọc từ Inventory, không giữ chỗ). Kiểm tra lại khi duyệt (cả hai bước).
- GIR không giữ chỗ Inventory; chỉ GI `WAITING_FOR_APPROVE` giữ chỗ (ADR-0004).

## Duyệt hai bước `AVAILABLE_STOCK` (ngoại lệ ADR-0007)
- Bước 1 Sales → bước 2 Quản lý kho; `approval_status` vẫn `WAITING_FOR_APPROVE` cho đến khi bước 2 duyệt → `APPROVED`. Bước hiện tại lưu riêng (cột/bảng chốt ở ERD).
- Thu hồi làm mất hiệu lực xác nhận các bước của vòng cũ; vòng mới bắt đầu từ Sales. Lịch sử từng bước được lưu.
- Các loại chứng từ khác giữ một cấp.

## Hoàn thành xuất
- Trạng thái thực hiện riêng (`execution_status`) với giá trị `COMPLETED`; `approval_status` giữ `APPROVED`.
- Thao tác: khóa dòng GIR (`pessimistic_write`) → chặn nếu còn GI `DRAFT`/`WAITING_FOR_APPROVE` → tổng hợp lượng thực xuất → giải phóng phần dư khỏi hạn mức (khóa dòng HĐ) → đặt `COMPLETED`.
- Tạo GI cũng khóa dòng GIR → không có GI mới chen vào.

## Thu hồi GIR
- Về `DRAFT`. Cho phép khi chưa có GI, hoặc mọi GI đã `CANCELED` (không có GI `APPROVED`). Kiểm tra trong transaction khóa dòng GIR.

## Còn mở (đã đóng — xem Bổ sung)

## Bổ sung 2026-11-13 (đóng G1–G5)
- `execution_status`: `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED`.
- Hoàn thành xuất chặn khi còn GI `DRAFT`/`WAITING_FOR_APPROVE`/`REJECTED`; thiếu số lượng → bắt buộc lý do.
- Từ chối ở bước Sales hoặc Quản lý kho → `REJECTED`, thông báo PM; duyệt lại từ đầu sau Thu hồi.
- Kho bảo hành/hàng hỏng mặc định không hợp lệ cho `AVAILABLE_STOCK`.
