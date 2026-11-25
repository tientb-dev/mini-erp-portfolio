# ADR-0009: HĐ bán, dòng HĐ và Product được phép giao

- **Trạng thái:** Đã chấp nhận — 2026-11-13
- **Đóng:** U2, U4, U7 (một phần), I2. **Thay thế:** T3 ("dòng HĐ chỉ dùng mã chính").

## Quyết định
- HĐ có `status`: `DRAFT`, `ACTIVE`, `CANCELED` — **không** dùng `approval_status`, không workflow duyệt. Sales tạo/sửa/chốt; chỉ HĐ `ACTIVE` được PR/GIR tham chiếu.
- HĐ `ACTIVE` khóa nội dung; HĐ đã được PR/GIR tham chiếu khóa khách hàng, PN, UoM, số lượng, điều khoản liên quan.
- Dòng HĐ có ID riêng (`sales_contract_lines.id`), snapshot hàng hóa và tối đa một tham chiếu danh mục. SC-LINE-INPUT-001 cho phép mã chính, mã tạm hoặc nhập tự do.
- Liên kết **dòng HĐ ↔ nhiều Product** được phép giao (tên bảng chốt ở ERD): PM đề xuất kèm lý do; Sales xác nhận/từ chối; lưu người xác nhận, thời điểm, ghi chú/số phụ lục.
- Liên kết nhu cầu trên PR, xác định mã chính thực nhận ở GRR và xác nhận Product được phép giao là các trách nhiệm độc lập.
- Liên kết PR theo DEC-19-02. GIR theo các liên kết nguồn và hạn mức tại ADR-0012.

## Ranh giới module
- Sales Contracts sở hữu HĐ, dòng HĐ và liên kết Product được phép giao. Procurement và Outbound phụ thuộc Sales Contracts qua facade (đúng đồ thị ADR-0002).
- Outbound gọi facade Sales Contracts để: kiểm tra HĐ `ACTIVE`, Product đã xác nhận cho dòng HĐ, và khóa dòng HĐ khi kiểm tra hạn mức (ADR-0010).

## Ngoài MVP / chưa chốt
- Phụ lục, điều chỉnh HĐ đã chốt, versioning: ngoài MVP.

## Bổ sung 2026-11-13 (đóng H1–H5)
- HĐ `ACTIVE` không quay lại `DRAFT`. Hủy HĐ chỉ khi không còn PR/GIR chưa `CANCELED` tham chiếu (dấu tham chiếu theo ARCHITECTURE §2.1).
- Đề xuất Product cho dòng HĐ: `PENDING` → `APPROVED` | `REJECTED`. Không thu hồi `APPROVED` khi còn GIR chưa `CANCELED` dùng. Đề xuất chưa `APPROVED` không làm Product "đã sử dụng".
- Không hạn mức riêng theo Product; chỉ theo dòng HĐ.
