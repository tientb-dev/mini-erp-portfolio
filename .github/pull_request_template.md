## Summary
<!-- Thay đổi gì và vì sao (1–3 câu). -->

## Scope
- Module/vertical slice:
- Trong phạm vi:
- Ngoài phạm vi (cố ý không làm):

## Business Rules
<!-- Tham chiếu mục tài liệu: 01-MVP-SCOPE, 03-BUSINESS-RULES §, 04-PERMISSIONS §, ADR-xxxx. Ghi rõ giả định (OPEN-QUESTIONS §3). -->
-

## Tests
- [ ] Unit test domain
- [ ] API test (quyền theo loại chứng từ + phạm vi kho)
- [ ] Integration test trên PostgreSQL thật (hạn mức / tồn kho / SN / đồng thời)
- [ ] UI test (vitest)
- [ ] Acceptance ID (docs/05):
- [ ] `pnpm test` và `pnpm build` pass

## Screenshots
<!-- Nếu có thay đổi UI. -->

## Risks
<!-- Migration, dữ liệu, tương thích, hiệu năng, rollback. -->

## Checklist
- [ ] Không có secrets / `.env` trong diff
- [ ] Không vi phạm đồ thị phụ thuộc module (chỉ qua facade)
- [ ] Use case ghi = một transaction; khóa `FOR UPDATE` theo thứ tự xác định
- [ ] Migration commit kèm (không `synchronize`)
- [ ] Lỗi theo RFC 9457 với `code` nghiệp vụ; dữ liệu cũ → 409
- [ ] Chuỗi UI qua i18n (`vi`, `en`)
- [ ] Không tự đặt quy tắc cho mục "Cần làm rõ"
- [ ] Đã cập nhật tài liệu/ADR nếu hành vi hoặc kiến trúc thay đổi
