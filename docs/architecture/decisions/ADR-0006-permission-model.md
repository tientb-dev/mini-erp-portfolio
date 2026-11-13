# ADR-0006: Phân quyền Function–Action

- **Trạng thái:** Đã chấp nhận — 2026-11-12
- **Thay thế:** đề xuất grant (permission, document type, warehouse) trong bản ban đầu

## Quyết định
- **User → Role → Permission**, permission dạng `FUNCTION.ACTION` (vd. `PR.CREATE`, `PO.APPROVE`, `GR.DECLARE_DETAILS`, `GI.APPROVE`, `INVENTORY.VIEW`, `SN_HISTORY.VIEW`).
- Bảng: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_warehouses`.
- Ba lớp tách biệt: permission (loại thao tác) → warehouse scope (kho) → business rules (trạng thái, người tạo không tự duyệt, hạn mức, tồn, SN).
- Không xây authorization engine; một guard + một service kiểm tra quyền.
- Giữ ngoại lệ nghiệp vụ: `GR.DECLARE_DETAILS`, người tạo luôn xem chứng từ của mình, lịch sử SN không tiết lộ ngoài phạm vi kho.

## Bổ sung 2026-11-13 (đóng P1, U7, U8)
- Giữ `user_warehouses`; **không** có role khác nhau theo từng kho, không phân quyền chi nhánh/phòng ban. Chấp nhận giới hạn "xem tồn kho A nhưng chỉ duyệt kho B" không diễn đạt được.
- Vai trò nghiệp vụ: Sales (HĐ, xác nhận Product được phép giao, bước 1 GIR `AVAILABLE_STOCK`), PM (GIR, đề xuất Product), Quản lý kho (GI, duyệt GIR, hoàn thành xuất) — 04 §2.
- **Người duyệt mặc định** cấu hình theo role hoặc bước duyệt (không một flag chung); hệ thống tự điền, cho chọn người khác đủ điều kiện; không có mặc định mà nhiều người hợp lệ → người tạo phải chọn. Backend kiểm tra quyền + kho của người được chọn khi Gửi duyệt.
- UI nêu lý do khi người dùng không đủ quyền thao tác.

## Hệ quả
- Đơn giản, dễ hiểu, dễ seed dữ liệu.
- Cần một cấu hình người duyệt mặc định (theo loại chứng từ + bước + role/user) và lưu người duyệt được chỉ định trên chứng từ/bước — chốt ở ERD.

## Bổ sung 2026-11-13 (đóng P3, P4)
- Hai lớp: RBAC `FUNCTION.ACTION` + **data-level authorization theo người được giao duyệt** (assigned approver lưu trên chứng từ/bước). Chỉ người được giao thấy trong "Chờ tôi duyệt", nhận thông báo và được Duyệt/Từ chối.
- Người duyệt mặc định theo role/bước; không xác định duy nhất → người tạo chọn từ dropdown.
