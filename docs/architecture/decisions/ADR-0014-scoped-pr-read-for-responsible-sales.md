# ADR-0014: Sales phụ trách xem PR của HĐ mình phụ trách (chỉ xem)

- **Trạng thái:** **Đã bị thay thế bởi [ADR-0018](ADR-0018-organization-authorization.md) tại OA3.3b (BA đã nghiệm thu):** đọc PR cần `PR.VIEW` có scope khớp (Sales/PM: C R G); không còn đọc ngầm qua `SALES_CONTRACT.VIEW`, người tạo, người phụ trách hay người được giao. Nội dung dưới đây chỉ còn giá trị lịch sử (duyệt 2026-11-15, PR #17).
- **Sửa đổi:** 04-PERMISSIONS §2 (dòng Sales). Không đổi ADR-0006 (permission `FUNCTION.ACTION` + business rule riêng).

## Bối cảnh
Trang chi tiết HĐ có tab Đề nghị mua (PR). Vai trò Sales không có `PR.VIEW`, nên tab bị ẩn. Sales được xem **mọi** HĐ (04 §2) và mọi PR đều gắn một HĐ (`purchase_requisitions.sales_contract_id` NOT NULL), nên "PR của HĐ Sales được xem" sẽ tương đương xem mọi PR.

## Quyết định
1. Người có `PR.VIEW`: không đổi, xem mọi PR.
2. Người **không có** `PR.VIEW` nhưng có `SALES_CONTRACT.VIEW` được **xem** (không ghi) PR của HĐ có `responsible_sales_user_id` = chính họ:
   - `GET /purchase-requisitions?salesContractId=<id>`: chỉ khi là Sales phụ trách HĐ đó. Không có `salesContractId` → 403 (không bao giờ trả cả danh sách).
   - `GET /purchase-requisitions/:id`: chỉ khi là Sales phụ trách HĐ của PR; danh sách PO con (`children`) trả rỗng, vì không mở rộng `PO.VIEW`.
   - Ngoài phạm vi, kể cả id không tồn tại → **403 như nhau**, không lộ id nào tồn tại.
3. Không permission mới, không đổi seed: đây là business rule kiểm tra trong `ProcurementService` (ADR-0006). Procurement đọc Sales phụ trách qua `SalesContractFacade.responsibleSalesOf`, đúng hướng phụ thuộc hiện có.
4. Mọi API ghi PR (tạo, sửa, gửi duyệt, duyệt, từ chối, thu hồi, hủy), `GET /purchase-requisitions/:id/lines`, cùng PO/GRR vẫn yêu cầu permission cũ.
5. Web: tab PR hiện khi có `PR.VIEW` hoặc người dùng là Sales phụ trách HĐ. Route `/purchase-requisitions/:id` mở được với `SALES_CONTRACT.VIEW` (`DETAIL_ALSO`), còn trang danh sách PR vẫn ẩn. Ẩn menu chỉ là UX; server mới là nơi kiểm soát.

## Hệ quả
- Sales không phụ trách HĐ (kể cả người tạo HĐ) không thấy PR của HĐ đó. Nếu cần mở rộng (người tạo, theo khách hàng) thì phải ra quyết định mới.
- Đổi Sales phụ trách chỉ làm được khi HĐ còn `DRAFT` (CT17), mà PR chỉ tham chiếu HĐ `ACTIVE`, nên phạm vi xem ổn định sau khi chốt.
- Test: `apps/api/src/pr-scope.int.spec.ts`.
