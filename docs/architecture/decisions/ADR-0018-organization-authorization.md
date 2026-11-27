# ADR-0018: Organization & Authorization

- **Trạng thái:** Đã chấp nhận — 2026-11-27 (OA0 hoàn thành). Kiến trúc đã duyệt; chức năng chưa triển khai, hiện thực từ OA1.
- **Một phần thay thế:** [ADR-0006](ADR-0006-permission-model.md) (VIEW toàn cục, "không phân quyền phòng ban", "người tạo luôn xem chứng từ của mình")
- **Thay thế:** [ADR-0014](ADR-0014-scoped-pr-read-for-responsible-sales.md) (đọc PR ngầm của Sales phụ trách)
- **Sửa đổi:** [ADR-0015](ADR-0015-purchase-requisition-workflow.md), gồm pool Role + User và bỏ đọc PR ngầm theo quyền thao tác. Quy tắc workflow và Reassign giữ nguyên.
- **Đặc tả:** [ORGANIZATION-AUTHORIZATION.md](../ORGANIZATION-AUTHORIZATION.md). Các mã BA-* ở §2 của đặc tả.

## Bối cảnh

- RBAC hiện có đúng hướng nhưng chưa quản trị được.
- VIEW là toàn cục, và có nhiều đường đọc ngầm qua người tạo, người phụ trách, người được giao.
- Organization chưa có.
- Truy vấn grant rải rác ở 5 nơi.
- BA đã chốt toàn bộ Q-01…Q-16 và Common Authorization Standard.

## Quyết định

1. **RBAC:** giữ `User → Role → Permission`. Quyền là hợp các Role đang hoạt động. Không cấp trực tiếp, không kế thừa, không DENY. Catalog do hệ thống định nghĩa.
2. **Chỉ Role hệ thống ADMIN quản trị hệ thống.** Permission quản trị (`admin_only`) không gán được cho Role thường. Quản lý nghiệp vụ (`PR.REASSIGN`, `PR.DOSSIER_MANAGE`) không phải quản trị. Không có Delegated Administration. Có bảo vệ Admin cuối cùng; ADMIN không tự đổi Role, tài khoản, nhân sự, membership của mình.
3. **Common Authorization Standard** (BA-AUTH-01…12):
   - Đọc chứng từ cần `X.VIEW` + Data Scope khớp.
   - Không có quyền đọc ngầm qua người tạo, người phụ trách, người được phân công hay Organization.
   - Thiếu scope thì từ chối.
   - Thao tác cần quyền hành động + scope + quyền đọc + Business Rules. CREATE đánh giá trên trạng thái dự kiến tạo.
   - Business Rules thuộc từng phân hệ; không có quy tắc "chỉ người tạo được sửa" cho toàn ERP.
   - ADMIN vẫn tuân thủ Business Rules.
4. **Data Scope** cấu hình theo cặp Role–Permission với 7 loại cố định. Mỗi permission khai báo scope hỗ trợ. Hợp scope trong cùng permission.
5. **Organization** gồm cây đơn vị, chức danh, membership có lịch sử. Organization không cấp quyền. HĐ và PR lưu `owner_org_unit_id` lúc tạo. PO và kho áp dụng ở phase nghiệp vụ.
6. **Tài khoản:**
   - Mật khẩu ≥ 12 ký tự.
   - Bắt đổi mật khẩu khởi tạo và sau reset.
   - Sai 5 lần liên tiếp thì khóa 15 phút; ADMIN mở khóa được.
   - Phiên lưu trong `user_sessions`: logout thu hồi phiên hiện tại; đổi/reset mật khẩu hoặc vô hiệu hóa thì thu hồi toàn bộ, kể cả phiên hiện tại, không cấp token mới. Token cũ không sống lại khi kích hoạt lại tài khoản. Rate limit đăng nhập và kiểm tra mật khẩu hiện tại bổ trợ cho khóa tài khoản; đăng nhập thất bại với username không tồn tại ghi vào `auth_events` append-only.
7. **Nhóm ứng viên** Role + User có ID số, dùng cho 5 nhóm. Có permission không đồng nghĩa là ứng viên. Ứng viên trên chứng từ cần thêm quyền đọc và quyền xử lý khớp scope, đánh giá trên trạng thái dự kiến sau phân công.
8. **Authorization tập trung** (`modules/identity/authorization.ts`, module hàm, không phải Nest provider) nhận `EntityManager` của transaction. Có `v_user_grants` cho đường đọc, `grantRole(..., lock)` (`FOR SHARE` trên bảng gốc) giữ live grant check của PR. Role ADMIN được bảo vệ bằng trigger DB. Bảo vệ Admin cuối cùng có mặt ngay từ phase đầu tiên có API thay đổi trạng thái hoặc quyền của Admin. Thao tác thu hồi grant lấy advisory lock `grants` exclusive, kiểm tra quyền trực tiếp lấy shared, theo thứ tự admin-guard → grants → users → roles → grant rows.
9. **Legacy:** ưu tiên đúng thiết kế mới. Được dọn chứng từ thử nghiệm sau khi backup và được duyệt. Không backfill hay compatibility layer. Snapshot quyền phân loại khác biệt "đã duyệt" và "ngoài dự kiến".
10. **Không xây:** Rule Engine, Workflow Engine động, Field-level Permission, MFA, SSO, HRM, microservices.

## Hệ quả

- Ba lớp kiểm tra của ADR-0006 trở thành: Action Permission → Data Scope (gồm kho) → Business Rules.
- Test hiện có dựa vào đọc ngầm PR phải cập nhật có chủ đích.
- Chứng từ kho còn đọc ngầm (người tạo, người được giao) đến phase kho. Đây là lệch đã biết, có kế hoạch xử lý.
- Grant HĐ và PR cấu hình lại theo bảng BA duyệt trước OA3.
- Roadmap tuần tự OA0 → OA7. UI đi cùng từng phase.
