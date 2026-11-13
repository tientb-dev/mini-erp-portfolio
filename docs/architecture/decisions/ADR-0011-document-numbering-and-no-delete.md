# ADR-0011: Đánh số chứng từ, không xóa, đính kèm

- **Trạng thái:** Đã chấp nhận — 2026-11-13
- **Đóng:** Q6

## Quyết định
- `document_number` tự sinh khi tạo cho HĐ, PR, PO, GRR, GR, GIR, GI; định dạng `<PREFIX>-<YYYY>-<NNNNNN>` với tiền tố `SC`, `PR`, `PO`, `GRR`, `GR`, `GIR`, `GI`.
- Một dãy cho mỗi (loại chứng từ, năm); không theo kho. Bất biến, không lùi, không tái sử dụng; chấp nhận khoảng trống.
- Cấp số trong cùng transaction tạo chứng từ, bằng một bảng bộ đếm theo (loại, năm) khóa `pessimistic_write` (hoặc `INSERT … ON CONFLICT … RETURNING`). Unique index trên (loại, `document_number`) là lớp bảo vệ cuối. Không dùng `MAX()+1`. Không dùng PostgreSQL sequence vì cần reset theo năm (sequence vẫn chấp nhận được nếu ERD chọn — khoảng trống đã được chấp nhận).
- `id` (khóa chính) tách biệt `document_number`.
- **Không xóa chứng từ**, kể cả `DRAFT`; chỉ `CANCELED`. API không có endpoint DELETE cho chứng từ.
- Tab chứng từ: Thông tin chung, Người phê duyệt, Hồ sơ đính kèm, Ghi chú (+ "Chi tiết hàng nhập kho" cho GR). Đính kèm và ghi chú ở mức cơ bản.

## Còn mở (đã đóng — xem Bổ sung)

## Bổ sung 2026-11-13 (đóng A1)
- File đính kèm lưu trên local storage của backend (thư mục cấu hình qua env, mount volume khi chạy Docker); metadata (tên, kích thước, MIME, người tải, thời điểm, chứng từ) trong DB.
