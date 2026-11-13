# ADR-0009: HĐ bán, dòng HĐ và Product được phép giao

- **Trạng thái:** Đã chấp nhận — 2026-11-13
- **Đóng:** U2, U4, U7 (một phần), I2. **Thay thế:** T3 ("dòng HĐ chỉ dùng mã chính").

## Quyết định
- HĐ có `status`: `DRAFT`, `ACTIVE`, `CANCELED` — **không** dùng `approval_status`, không workflow duyệt. Sales tạo/sửa/chốt; chỉ HĐ `ACTIVE` được PR/GIR tham chiếu.
- HĐ `ACTIVE` khóa nội dung; HĐ đã được PR/GIR tham chiếu khóa khách hàng, PN, UoM, số lượng, điều khoản liên quan.
- Dòng HĐ có ID riêng (`sales_contract_lines.id`) và lưu nguyên thông tin hàng hóa khách ký; không bắt buộc `product_id`.
- Liên kết **dòng HĐ ↔ nhiều Product** được phép giao (tên bảng chốt ở ERD): PM đề xuất kèm lý do; Sales xác nhận/từ chối; lưu người xác nhận, thời điểm, ghi chú/số phụ lục.
- Hai trách nhiệm tách biệt: mapping dòng PR → Product (ADR-0008, chuẩn hóa hàng mua) và xác nhận Product cho dòng HĐ (hàng được phép giao).
- Dòng PR và dòng GIR tham chiếu `sales_contract_line_id`.

## Ranh giới module
- Sales Contracts sở hữu HĐ, dòng HĐ và liên kết Product được phép giao. Procurement và Outbound phụ thuộc Sales Contracts qua facade (đúng đồ thị ADR-0002).
- Outbound gọi facade Sales Contracts để: kiểm tra HĐ `ACTIVE`, Product đã xác nhận cho dòng HĐ, và khóa dòng HĐ khi kiểm tra hạn mức (ADR-0010).

## Ngoài MVP / chưa chốt
- Phụ lục, điều chỉnh HĐ đã chốt, versioning: ngoài MVP.

## Bổ sung 2026-11-13 (đóng H1–H5)
- HĐ `ACTIVE` không quay lại `DRAFT`. Hủy HĐ chỉ khi không còn PR/GIR chưa `CANCELED` tham chiếu (dấu tham chiếu theo ARCHITECTURE §2.1).
- Đề xuất Product cho dòng HĐ: `PENDING` → `APPROVED` | `REJECTED`. Không thu hồi `APPROVED` khi còn GIR chưa `CANCELED` dùng. Đề xuất chưa `APPROVED` không làm Product "đã sử dụng".
- Không hạn mức riêng theo Product; chỉ theo dòng HĐ.
