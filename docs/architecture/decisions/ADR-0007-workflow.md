# ADR-0007: Workflow phê duyệt một cấp

- **Trạng thái:** Đã chấp nhận — 2026-11-12

## Quyết định
- Một cấp phê duyệt cho PR, PO, GRR, GR, GIR `SALES_CONTRACT`, GI theo 03 §6. **Ngoại lệ duy nhất:** GIR `AVAILABLE_STOCK` hai bước tuần tự Sales → Quản lý kho (ADR-0010). HĐ không duyệt, dùng `DRAFT`/`ACTIVE`/`CANCELED` (ADR-0009).
- Thu hồi luôn về `DRAFT`, phải Gửi duyệt và duyệt lại (W2, 2026-11-13). Điều kiện Thu hồi PR/PO/GRR/GR giữ như đã chốt.
- Không xóa chứng từ; chỉ `CANCELED` (ADR-0011).
- `approval_status` chỉ mang trạng thái phê duyệt. Mã: `DRAFT`, `WAITING_FOR_APPROVE` (không dùng `PENDING`), `APPROVED`, `REJECTED`, `CANCELED` (không dùng `CANCELLED`) — cập nhật 2026-11-13. Quy tắc chuyển trạng thái không đổi. Trạng thái thực hiện (tiến độ nhập PO, hoàn tất/đóng sớm GIR) là trường riêng.
- Chuyển trạng thái bằng `UPDATE` có điều kiện trạng thái hiện tại; kiểm tra lại hạn mức/nguồn tại Gửi duyệt và Duyệt.
- Lý do Từ chối/Thu hồi, ghi chú bổ sung (chỉ thêm) và thông báo ghi trong cùng transaction.
- Module chứng từ tự kiểm tra điều kiện Thu hồi/Hủy; Workflow chỉ cung cấp cơ chế chung.

## Hệ quả
- GR Đã duyệt → Nháp (Thu hồi) đã chốt ở 03 §2.2; Workflow phải lưu lịch sử mỗi lần Duyệt/Thu hồi (người, thời điểm, lý do).
- GIR: trạng thái thực hiện `COMPLETED` tách khỏi `approval_status` (ADR-0010). Workflow cần lưu bước duyệt hiện tại và lịch sử từng bước cho GIR `AVAILABLE_STOCK`.
