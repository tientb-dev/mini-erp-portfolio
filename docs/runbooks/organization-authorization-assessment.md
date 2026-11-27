# Assessment · Organization & Authorization

Ngày 26/11/2026. Tài liệu này chỉ đánh giá hiện trạng và đề xuất, chưa có thay đổi code, migration, dữ liệu hay quyền. Nguồn căn cứ là source tại `f983db0`, tài liệu 01–05, ARCHITECTURE, FRONTEND, OPEN-QUESTIONS, BACKEND-AUDIT, roadmap Dossier/Organization và các ADR 0002, 0006, 0007, 0014, 0015, 0016, 0017.

> **Cập nhật 27/11/2026:** BA đã trả lời L1–L6 và chọn Data Scope cấu hình theo Role–Permission thay cho quy ước ở §I. Kiến trúc chính thức: [ORGANIZATION-AUTHORIZATION.md](../architecture/ORGANIZATION-AUTHORIZATION.md).

## A. Git và baseline

- `main`, `origin/main` và HEAD trỏ cùng commit `f983db0b1f91a6bcf756898f1dfd58214f702f71`. Working tree sạch.
- Branch `feat/sales-contract-completion` không có commit hoặc thay đổi nào so với `main`. Branch được giữ lại.
- Branch làm việc: `feat/organization-authorization`, tạo từ `main`. Chỉ file này được thêm vào branch.

## B. Kiến trúc phân quyền hiện tại

**Mô hình đã chốt** (ADR-0006, ARCHITECTURE §6):

- `User → Role → Permission` với permission dạng `FUNCTION.ACTION`, cộng phạm vi kho `user_warehouses`.
- Có ba lớp kiểm tra: permission ở guard → phạm vi kho → business rule. Lớp cuối gồm trạng thái, người tạo không tự duyệt và người được giao duyệt.
- ADR-0006 yêu cầu "một guard và một service kiểm tra quyền, không xây authorization engine".

**Implementation thực tế:**

| Thành phần | Vị trí | Hành vi |
|---|---|---|
| Xác thực | `AuthGuard` trong [auth.ts](../../apps/api/src/modules/identity/auth.ts) (guard global) | Đọc Bearer JWT `{ sub }`, ký bằng `JWT_ACCESS_SECRET`, TTL `JWT_ACCESS_TTL` mặc định 8h ([identity.module.ts](../../apps/api/src/modules/identity/identity.module.ts)). Không có refresh token hay danh sách thu hồi token (IM3). Web lưu token trong `sessionStorage`. |
| Nạp quyền | `IdentityService.loadCurrentUser` | **Mỗi request** đọc lại user `is_active`, roles, permissions và warehouses từ DB. Vì vậy thu hồi quyền hoặc vô hiệu hóa user có hiệu lực ở request kế tiếp dù JWT còn hạn. Đây là điểm mạnh nên giữ. |
| Kiểm tra quyền | `@RequirePermissions(...)` (cần đủ tất cả quyền liệt kê), `@Public()` | Endpoint không gắn decorator chỉ yêu cầu đăng nhập. Service tự kiểm thêm bằng `user.permissions.includes(...)`. |
| Kiểm tra live trong transaction | `currentGrant`, `eligible` ([pr-eligibility.ts](../../apps/api/src/modules/procurement/pr-eligibility.ts)) | PR khóa grant bằng `FOR SHARE OF u, ur, rp` để thao tác không chạy đua với việc thu hồi quyền. |
| Phạm vi kho | `wf.assertWarehouse` ([workflow.ts](../../apps/api/src/modules/workflow/workflow.ts)) và SQL list `= ANY(warehouseIds)` | Áp dụng cho GRR/GR/GIR/GI/Inventory. |
| Scope chứng từ | Viết tay trong từng service | PR: `assertPrReadScope`, `listPrs`, `getPr` ([procurement.service.ts:550-629](../../apps/api/src/modules/procurement/procurement.service.ts#L550-L629)). Kho: kho được phép, hoặc là người tạo, hoặc là người được giao duyệt. |

**Nhận định:**

- Lớp RBAC đơn giản và đúng hướng. Không có chỗ nào hardcode tên role trong logic nghiệp vụ. Các hằng `SALES`/`PM` trong Procurement là tên **luồng** PR (`creator_route`) và tên pool, không phải role.
- Phần còn thiếu là **khả năng quản trị**: không có API hay UI cho User, Role, gán Permission hoặc gán kho. Hiện chỉ cấu hình được qua seed và SQL. Mục tiêu "Admin cấu hình không cần deploy" hiện chưa đạt ở bất kỳ mức nào.
- Data Scope không có khái niệm chung. Mỗi module tự viết điều kiện, và chỉ PR có scope theo quan hệ nghiệp vụ.

## C. Schema và quan hệ

```
users ──< user_roles >── roles ──< role_permissions >── permissions
  └──< user_warehouses >── warehouses
sales_contracts.responsible_sales_user_id / responsible_pm_user_id → users
pr_candidate_pool_members (pool SALES|PM|RECEIPT, user_id)
pr_workflow_nodes (assignee_id, department = tên role cấp quyền, snapshot)
```

- [Foundation](../../apps/api/src/database/migrations/1731456000000-Foundation.ts):
  - `permissions(id, code)`: không có tên hiển thị, mô tả hay nhóm module.
  - `roles(id, code, name)`: không có trạng thái, không có cờ hệ thống.
  - `users(username, password_hash, full_name, is_active)`.
- **Không có Employee riêng.** Roadmap đã chốt "Employee và User dùng chung hồ sơ người dùng" ([roadmap](../architecture/DOCUMENT-DOSSIER-ORGANIZATION-ROADMAP.md#organization-master-data)). Không nên tạo bảng Employee tách rời.
- **Chưa có Organization.** Không có bảng phòng ban, đơn vị, chức danh hay quản lý trực tiếp, cũng không có logic cấp quyền theo cây tổ chức. Cột `pr_workflow_nodes.department` chỉ là snapshot tên role (`eligible().role`), không phải phòng ban. Nên đổi nhãn khi làm Organization để tránh nhầm (UI đã dùng nhãn "Vai trò", ADR-0015).
- **Mâu thuẫn tài liệu:** [01-MVP-SCOPE §4](../01-MVP-SCOPE.md) xếp "phân quyền chi nhánh/phòng ban" ngoài phạm vi MVP, ADR-0006 ghi "không phân quyền chi nhánh/phòng ban", trong khi roadmap mới yêu cầu Organization. Hai yêu cầu không loại trừ nhau nếu Organization **không cấp quyền**, nhưng cần cập nhật 01 và ADR-0006 khi BA chốt (L1).
- Permission phần lớn được tạo **bằng seed** ([seed.ts](../../apps/api/src/database/seed.ts)), không qua migration. Ngoại lệ: dossier trong `1733184000000`. Môi trường không chạy seed sẽ thiếu key.

## D. Permission Inventory

Ký hiệu role: S = SALES, PM, PU = PURCHASING, SH = SALES_HEAD, PH = PM_HEAD, WM = WAREHOUSE_MANAGER. ADMIN có mọi quyền. `COMMON` (mọi role) gồm `PRODUCT.VIEW`, `WAREHOUSE.VIEW`, `SALES_CONTRACT.VIEW`.

| Module | Permission key | Ý nghĩa | API dùng | UI dùng | Role |
|---|---|---|---|---|---|
| Master Data | `PRODUCT.VIEW` | Đọc hàng hóa, hãng, mã tạm, ĐVT, tiền tệ, thuế; product picker | master-data, pr-catalog, `product-picker/:source` | routes | COMMON |
| | `PRODUCT.CREATE` / `PRODUCT.UPDATE` | Tạo/sửa mã chính | master-data | catalogs | PU / – |
| | `PROCUREMENT_CATALOG.MANAGE` | Quản lý hãng, mã tạm, tiền tệ, thuế | pr-catalog | routes, catalogs | – |
| | `UOM.MANAGE` | Quản lý ĐVT | master-data | catalogs | – |
| | `WAREHOUSE.VIEW/CREATE/UPDATE` | Kho | master-data | routes, catalogs | COMMON / – / – |
| | `CUSTOMER.VIEW/CREATE/UPDATE` | Khách hàng | master-data | routes, SC page | S / S / – |
| | `SUPPLIER.VIEW/CREATE/UPDATE` | NCC; VIEW còn gate liên kết Hãng–NCC | master-data, pr-catalog | routes, CatalogEditor | PU / PU / – |
| Dossier | `DOSSIER_TYPE.VIEW/MANAGE`, `DOSSIER_CONFIG.MANAGE` | Danh mục và cấu hình hồ sơ | dossier.module | routes, catalogs | – |
| HĐ | `SALES_CONTRACT.VIEW` | Đọc mọi HĐ; điều kiện của ngoại lệ đọc PR (ADR-0014) | sales-contracts, procurement.service | routes, ScDetailView, InventoryLots | COMMON |
| | `SALES_CONTRACT.CREATE` | Tạo/sửa/chốt/hủy HĐ; điều kiện để được làm Sales phụ trách | sales-contracts | SC pages | S |
| | `SALES_CONTRACT.PROPOSE_PRODUCT` / `CONFIRM_PRODUCT` | Đề xuất/xác nhận mã giao (**legacy, đã duyệt loại bỏ**) | sales-contracts | ScLinesTab | PM / S |
| PR | `PR.VIEW` | Xem mọi PR | procurement | routes, SC tab | PU |
| | `PR.CREATE` | Tạo/sửa/gửi/thu hồi/hủy PR của mình; điều kiện để được làm PM phụ trách HĐ | procurement, pr-workflow, sales-contracts facade | PR pages | S, PM |
| | `PR.APPROVE` / `PR.RECEIVE` | Đủ tư cách vào pool phê duyệt/tiếp nhận | pr-eligibility | DocListPage, AppShell | SH, PH / PU |
| | `PR.CONFIGURE` | Cấu hình pool, gán PM phụ trách | procurement | **không có UI** | – |
| | `PR.REASSIGN` | Phân công lại (quản trị) | pr-workflow | **không có UI riêng** | – |
| | `PR.DOSSIER_MANAGE` | Quản lý hồ sơ PR | procurement | DocDetailView | – |
| PO | `PO.VIEW/CREATE/APPROVE` | Xem/tạo-sửa-gửi-thu hồi-hủy/duyệt | procurement | routes | PU / PU / – |
| Nhập kho | `GRR.VIEW/CREATE/APPROVE`, `GR.VIEW/CREATE/APPROVE` | ĐNNK, PNK | inbound | routes, pages | WM |
| | `GR.DECLARE_DETAILS` | Khai báo chi tiết GR của người khác | inbound.service | GoodsReceiptsPage | WM |
| Xuất kho | `GIR.VIEW/CREATE/APPROVE/COMPLETE`, `GIR.SALES_CONFIRM` | ĐNXK, bước 1 Sales nguồn, hoàn thành xuất | outbound | pages | S (VIEW, SALES_CONFIRM), PM (VIEW, CREATE), WM |
| | `GI.VIEW/CREATE/APPROVE` | PXK | outbound | pages | WM |
| Tồn kho | `INVENTORY.VIEW` | Tồn, lô (theo kho) | inventory | routes | PM, WM |

**Phát hiện:**

1. **Key chết hoặc lệch tài liệu:**
   - `SN_HISTORY.VIEW` có trong ADR-0006 và ARCHITECTURE §6 nhưng không tồn tại trong code.
   - `PRODUCT.UPDATE`, `CUSTOMER.UPDATE`, `SUPPLIER.UPDATE`, `WAREHOUSE.UPDATE`, `UOM.MANAGE`, `PROCUREMENT_CATALOG.MANAGE`, `PR.CONFIGURE`, `PR.REASSIGN`, `PR.DOSSIER_MANAGE`, `PO.APPROVE`, `DOSSIER_*` chỉ có ở ADMIN. Không sai, nhưng các vai trò nghiệp vụ hiện không có ai làm được việc này.
2. **Một key gánh nhiều nghĩa:**
   - `SALES_CONTRACT.CREATE` vừa là quyền hành động, vừa là tiêu chí tư cách được làm Sales phụ trách (`responsibleSalesCandidates`).
   - `PR.CREATE` vừa là quyền hành động, vừa là tiêu chí PM phụ trách (`assignResponsiblePm`).
   - `SALES_CONTRACT.VIEW` vừa cho đọc mọi HĐ, vừa là điều kiện của ngoại lệ đọc PR.
   - Gộp nghĩa như vậy khiến Admin bỏ một quyền sẽ làm mất cả tư cách workflow. Cần tài liệu rõ, hoặc tách khi có nhu cầu (L4).
3. **Quá rộng:**
   - `SALES_CONTRACT.VIEW` nằm trong `COMMON`, nên mọi role đọc được mọi HĐ.
   - `SALES_CONTRACT.CREATE` cho sửa/chốt/hủy HĐ của bất kỳ ai (IM23).
4. **Có thể đã quá nhỏ:** `GRR.CREATE`/`GR.CREATE`/`GI.CREATE` cùng role và cùng cách dùng. Chưa đề xuất gộp vì chưa có nhu cầu nghiệp vụ.
5. **Backend/Frontend lệch:**
   - Tab PR trên HĐ ẩn với PM phụ trách có `PR.CREATE`, trong khi API cho xem ([ScDetailView.tsx:74](../../apps/web/src/features/sales-contracts/ScDetailView.tsx#L74) và `listPrs`).
   - `PO.CREATE`/`PO.APPROVE`/`GRR.CREATE`/`GI.APPROVE` không có gate tường minh ở UI; UI dựa vào field `can*` hoặc lỗi server. Cần xác minh từng nút khi làm UI.
6. **Seed hardcode:**
   - Seed xóa `PR.CREATE` khỏi `PURCHASING` mỗi lần chạy ([seed.ts:76](../../apps/api/src/database/seed.ts#L76)). Sau khi có UI quản trị, chạy lại seed sẽ **ghi đè cấu hình Admin**.
   - Seed chỉ thêm, không gỡ. Chạy lại seed trên môi trường đã cấu hình sẽ khôi phục những quyền Admin đã bỏ.

## E. Data Scope Matrix

Ký hiệu: **All** = có permission là đủ; **Kho** = `user_warehouses`; **Tạo** = người tạo; **Giao** = người được giao xử lý; **PT** = Sales/PM phụ trách HĐ.

| Module | List | Detail | Lookup/Picker | Mutation | Notes/History | File | Ghi chú |
|---|---|---|---|---|---|---|---|
| Master Data | All (VIEW) | All | All (`PRODUCT.VIEW`, `SUPPLIER.VIEW`) | All (CREATE/UPDATE/MANAGE) | – | – | Danh mục dùng chung; không cần scope |
| HĐ bán | All (VIEW) | All | `catalog/contracts` = ACTIVE và PT (`prOptions`) | All có CREATE, **không kiểm Tạo/PT** | Chưa có | Chưa có | Thiếu scope ghi (H-01) |
| PR | `PR.VIEW` = All; có CREATE/APPROVE/RECEIVE → Tạo ∪ Giao (từng là node) ∪ PT | Như List, trả 403 đồng nhất | Picker theo PT | Tạo + `PR.CREATE` live; workflow: Giao + eligible live | Theo quyền đọc | Theo quyền đọc; staging gắn actor | Mô hình đầy đủ nhất |
| PO | All (VIEW) | All | `available-for-po` All (CREATE) | Tạo (`wf.assertCreator`); duyệt: Giao | `approval_histories` legacy | – | Không có scope theo NCC/HĐ, hợp lý |
| ĐNNK/PNK | Kho ∪ Tạo (GR) / Kho ∪ Tạo ∪ Giao (GRR) | Như List ([inbound.service.ts:448](../../apps/api/src/modules/inbound/inbound.service.ts#L448), [:508](../../apps/api/src/modules/inbound/inbound.service.ts#L508)) | – | Kho + Tạo; `GR.DECLARE_DETAILS` ngoại lệ | legacy | – | GR detail bỏ qua người được giao duyệt; GRR thì tính (lệch nhỏ) |
| ĐNXK/PXK | Kho ∪ Tạo ∪ Giao | Như List ([gir.service.ts:242](../../apps/api/src/modules/outbound/gir.service.ts#L242), [gi.service.ts:174](../../apps/api/src/modules/outbound/gi.service.ts#L174)) | Nguồn tồn theo Kho | Kho + Tạo; bước 1 = Sales nguồn (invariant) | legacy | – | GI detail không tính người được giao |
| Tồn kho | Kho (`INVENTORY.VIEW`) | Kho | – | – | – | – | SQL nằm trong controller (BACKEND-AUDIT B8) |
| Thông báo PR | Người nhận | – | – | Đánh dấu đọc theo người nhận | – | – | Đúng |

**Phân biệt điều kiện phân quyền và invariant nghiệp vụ** (không đưa vào Data Scope cấu hình):

- Người tạo không tự duyệt (`eligible`, `wf.decide`).
- Bước 1 GIR B/D phải là Sales nguồn (CT7).
- Chỉ HĐ ACTIVE được làm nguồn PR.
- Sales/PM tạo PR **phải** là PT của HĐ (ADR-0015).
- Sales phụ trách khóa sau khi chốt (CT17).

Các điều kiện trên là quy tắc chứng từ, giữ trong code.

**Phần thực sự là Data Scope:** "xem tất cả" so với "chỉ chứng từ liên quan đến tôi" (Tạo ∪ Giao ∪ PT), và phạm vi kho. Hiện code dùng sự **có mặt của permission VIEW** để quyết định All, còn thiếu VIEW thì rơi về phạm vi liên quan. Riêng PR đã làm như vậy. HĐ, PO, Kho chưa có nhánh "liên quan đến tôi" ngoài Tạo/Giao.

## F. Workflow Authorization hiện tại

- **PR (ADR-0015):**
  - Pool `SALES`/`PM`/`RECEIPT` trong `pr_candidate_pool_members`, cấu hình qua `PUT /pr-workflow/routes/:route` với `PR.CONFIGURE`.
  - Tư cách = là thành viên pool + có `PR.APPROVE`/`PR.RECEIVE` live + tài khoản active + không phải người tạo (`eligible`). Khóa pool bằng advisory lock khi cấu hình.
  - Action kiểm tra lại assignment, tư cách và context `version/round/step` trong transaction. Thu hồi quyền có hiệu lực ngay, kể cả với node đang chờ.
  - Reassign có ba nhánh: `PR.REASSIGN`, người tạo có `PR.CREATE`, hoặc người nhận hiện tại còn eligible (`canReassign`).
  - **Organization không tham gia.** Pool chọn theo user, đúng nguyên tắc "không mặc định cấp quản lý là người duyệt".
- **PO/GRR/GR/GIR/GI:**
  - Người duyệt = user có `X.APPROVE` (+ kho) và khác người tạo (`wf.usersWithPermission`, IM12). Không có pool hay cấu hình mặc định.
  - Kiểm tra lúc action dùng `user.permissions` của request; không kiểm tra live dưới khóa như PR.
  - Nếu thu hồi quyền khi chứng từ đang chờ: người được giao gọi duyệt sẽ bị guard chặn, nhưng chứng từ **kẹt** vì không có Reassign. Người tạo phải Thu hồi và gửi lại.
- **Nhận định:** Candidate Pool của PR là cơ chế workflow tốt nhất hiện có và có thể tổng quát hóa khi cần. Nhưng **chưa nên** áp ngay cho PO/kho khi BA chưa yêu cầu, xem J.

## G. Màn hình quản trị

| Màn hình | Hiện trạng |
|---|---|
| Sidebar | `NAV` trong [routes.ts](../../apps/web/src/app/routes.ts) gồm Bán hàng, Mua hàng, Kho, Danh mục, Hệ thống. Nhóm "Hệ thống" chỉ có Cấu hình hồ sơ. Ẩn trang theo quyền VIEW. |
| User Management | **Không có** (cả API) |
| Role Management | **Không có** |
| Gán Permission | **Không có** |
| Gán kho cho user | **Không có** |
| Organization | **Không có** |
| Workflow config (pool PR, PM phụ trách) | **Chỉ có API**, không có UI |
| Đổi mật khẩu / reset | **Không có** |
| Common UI tái dụng được | `ListPageLayout`, `FilterToolbar`, `DataTable`, `CatalogPage`/`CatalogEditor` (pattern Master Data List/View/Edit với Switch trạng thái), `DetailPageLayout`, `FormDialog`, `ActionButton`/`ActionResultDialog`, Dirty Guard |

## H. Security findings, nợ kỹ thuật, điểm không nhất quán

| # | Mức | Phát hiện | Bằng chứng |
|---|---|---|---|
| H-01 | **High** | Mọi user có `SALES_CONTRACT.CREATE` sửa/chốt/hủy được HĐ của người khác; không kiểm Tạo/PT | `SalesContractsService.update/activate/cancel`, IM23 |
| H-02 | **High** | Không có quản trị user/role/permission: cấp quyền phải sửa seed/SQL trực tiếp, không có audit ai cấp quyền gì | Không có controller trong `modules/identity` ngoài `AuthController` |
| H-03 | **High** (khi có UI quản trị) | Chạy lại seed ghi đè cấu hình: xóa `PR.CREATE` của PURCHASING và thêm lại quyền theo `ROLES` | [seed.ts:76-83](../../apps/api/src/database/seed.ts#L76-L83) |
| H-04 | Medium | Login không giới hạn tần suất hay khóa tạm; không có chính sách mật khẩu; không có đổi/reset mật khẩu | `AuthController.login` |
| H-05 | Medium | Không có bảo vệ "tài khoản quản trị cuối cùng". Khi có UI, Admin có thể tự gỡ quyền quản trị của chính mình và khóa toàn hệ thống | thiết kế mới cần |
| H-06 | Medium | `SALES_CONTRACT.VIEW` cấp cho mọi role → đọc mọi HĐ. Cùng với ADR-0014, PR được bảo vệ, nhưng dữ liệu HĐ thì không | seed `COMMON` |
| H-07 | Medium | Workflow non-PR không kiểm tra live dưới khóa và không có Reassign; chứng từ có thể kẹt khi người duyệt mất quyền | `wf.decide`, `wf.usersWithPermission` |
| H-08 | Medium | Permission không có metadata (tên, mô tả, module), nên UI gán quyền chỉ hiển thị được mã; một phần key chỉ tồn tại qua seed | Foundation, seed |
| H-09 | Low | JWT 8h trong `sessionStorage`, không có refresh/logout phía server. Rủi ro giảm nhờ nạp quyền mỗi request và kiểm `is_active` | IM3 |
| H-10 | Low | `pr_workflow_nodes.department` thực chất lưu tên role, dễ nhầm với Organization | `eligible().role`, `reassign` |
| H-11 | Low | Detail GR/GI không cho người được giao duyệt ngoài kho xem, trong khi GRR/GIR cho; list và detail cũng theo cùng quy tắc lệch này | [inbound.service.ts:448](../../apps/api/src/modules/inbound/inbound.service.ts#L448), [gi.service.ts:174](../../apps/api/src/modules/outbound/gi.service.ts#L174) |
| H-12 | Low | Tài liệu nêu `SN_HISTORY.VIEW` nhưng code không có; 01-MVP-SCOPE/ADR-0006 lệch với roadmap Organization | §C, §D |
| H-13 | Low | Tab PR trên HĐ lệch với API đối với PM phụ trách | §D.5 |

Không phát hiện endpoint ghi nào thiếu kiểm tra quyền. Các endpoint PR không gắn decorator đều kiểm tra trong service, đã đối chiếu bằng quét toàn bộ controller.

## I. Kiến trúc mục tiêu

Nguyên tắc: giữ mô hình ADR-0006, bổ sung **khả năng quản trị** và **một quy ước scope**. Không xây engine.

| Thành phần | Quyết định | Lý do |
|---|---|---|
| Xác thực, nạp quyền mỗi request | **Giữ** | Thu hồi có hiệu lực ngay, đơn giản |
| `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_warehouses` | **Giữ, bổ sung cột** | Thêm `roles.is_active`, `roles.is_system`; thêm `permissions.module`, `permissions.name`, `permissions.description` (hoặc nhãn i18n theo key) và `users.updated_at/updated_by`, `password_changed_at` |
| Catalog permission | **Sửa:** khai báo trong code và đồng bộ bằng migration | Permission là hợp đồng với code; Admin gán, không tạo key mới. Seed chỉ tạo dữ liệu demo cho DB mới |
| Seed | **Sửa:** không ghi đè cấu hình | Bỏ `DELETE` hardcode; chỉ seed role/user demo khi DB rỗng |
| API quản trị Identity | **Xây mới** | CRUD User (không xóa, chỉ vô hiệu hóa), reset mật khẩu, gán role và kho; CRUD Role, gán permission. Quyền: `USER.MANAGE`, `ROLE.MANAGE`. Ghi audit bằng Activity History chung (thêm target `USER`, `ROLE`) |
| Bảo vệ Admin | **Xây mới** | Chặn thao tác khiến không còn user active nào có `ROLE.MANAGE` + `USER.MANAGE`; chặn tự vô hiệu hóa chính mình |
| Organization | **Xây mới, tách biệt** | `org_units` (cây `parent_id`), `job_titles`, `org_unit_members(user_id, org_unit_id, job_title_id, is_primary)`, `users.manager_user_id` (hoặc theo membership). Quyền `ORGANIZATION.MANAGE`. **Không** module nào đọc Organization để cấp quyền |
| Data Scope | **Quy ước, không cấu hình động** | Mỗi chứng từ có hai mức: `X.VIEW` = toàn bộ (giữ đúng nghĩa hiện tại của PR/PO/kho), thiếu VIEW = "liên quan đến tôi" (Tạo ∪ Giao ∪ PT) cộng phạm vi kho với chứng từ kho. Mỗi module viết điều kiện SQL của mình theo quy ước này. Không có bảng cấu hình scope |
| Scope theo Organization | **Chưa làm** | Mục tiêu cho phép dùng Organization làm tiêu chí "khi được cấu hình rõ", nhưng chưa có yêu cầu cụ thể (ví dụ trưởng bộ phận xem HĐ của bộ phận). Đây là mở rộng sau, không để sẵn chỗ (L3) |
| Workflow | **Giữ** Candidate Pool PR, **thêm UI** cấu hình pool và PM phụ trách | Đã hoàn thiện và được BA chốt |
| Workflow non-PR | **Giữ** cho đến khi làm từng chứng từ | Áp pool khi hoàn thiện PO/Kho theo phase của chúng |
| Legacy HĐ | **Bỏ** `SALES_CONTRACT.PROPOSE_PRODUCT/CONFIRM_PRODUCT` | Đã duyệt; làm trong phase HĐ |

## J. Phạm vi tối thiểu

**Phạm vi tối thiểu đủ để "Admin cấu hình quyền không cần deploy":**

1. Catalog permission có metadata, đồng bộ bằng migration; seed an toàn.
2. API và UI User (danh sách, tạo, sửa, vô hiệu hóa, reset mật khẩu, gán role và kho).
3. API và UI Role (danh sách, tạo, sửa, bật/tắt, gán permission theo nhóm module).
4. Bảo vệ Admin cuối cùng và audit thay đổi quyền.
5. UI cấu hình pool workflow PR và PM phụ trách (dùng API hiện có).
6. Organization: cây đơn vị, chức danh, thành viên, quản lý trực tiếp; chỉ quản trị và hiển thị.
7. Ghi quy ước Data Scope vào ADR mới (ADR-0018). Áp dụng cho HĐ khi tiếp tục Phase 5.2.3B, sửa H-01 tại đó.

**Không làm trong đợt này:** scope động theo Organization, rules engine, permission theo field, SSO, refresh token, workflow pool cho PO/kho, đổi mã permission hiện có.

## K. Kế hoạch triển khai theo checkpoint

| CP | Nội dung | Migration | Regression |
|---|---|---|---|
| OA1 · ADR và catalog | ADR-0018 (Organization ⟂ Authorization, quy ước Data Scope); cập nhật 01, ADR-0006, 04. Migration thêm metadata permission/role, chèn mọi key hiện có, **không đổi grant** | Additive; kiểm `role_permissions` trước và sau giống hệt | Toàn bộ suite API/Web; so snapshot grant theo role |
| OA2 · Seed an toàn | Bỏ `DELETE` hardcode; seed role/user demo chỉ khi chưa có | – | Test seed idempotent không thay đổi grant đã cấu hình |
| OA3 · Identity Admin API | User/Role/Assignment, reset mật khẩu, bảo vệ Admin cuối, audit; `USER.MANAGE`, `ROLE.MANAGE` cấp cho ADMIN bằng migration | Additive (cột audit, target history) | Integration: thiếu quyền → 403; vô hiệu hóa → request kế tiếp 401; gỡ quyền → 403 ngay; không gỡ được Admin cuối; PR eligibility phản ánh ngay |
| OA4 · UI quản trị | Nhóm sidebar "Hệ thống": Người dùng, Vai trò, Cấu hình workflow PR; dùng Common List/Form | – | Vitest + Chromium, UI-EVIDENCE-001 |
| OA5 · Organization | Schema, API, UI cây đơn vị/chức danh/thành viên/quản lý | Additive | Test: không có grant nào thay đổi khi đổi Organization; test kiến trúc cấm module nghiệp vụ import Organization để kiểm quyền |
| OA6 · Đồng bộ lệch nhỏ | H-11, H-13, đổi nhãn `department`; quyết định `SN_HISTORY.VIEW` | Không, hoặc rename cột có view tương thích | Suite inbound/outbound/procurement, pr-scope |

**Nguyên tắc migration quyền:** mọi migration chỉ thêm. Không đổi mã key, không gỡ grant. Mỗi CP so sánh `SELECT r.code, p.code FROM role_permissions …` trước và sau trên bản sao DB test, kết quả phải giống hệt trừ các key mới cấp cho ADMIN. Dev chỉ áp dụng sau khi Test đạt và đã backup.

## L. Cần BA xác nhận

1. **Phạm vi Organization:** xác nhận Organization chỉ để quản trị và hiển thị trong đợt này, không làm tiêu chí scope hay duyệt. Kèm theo là cập nhật 01-MVP-SCOPE §4 và ADR-0006 tương ứng.
2. **Một user thuộc nhiều đơn vị:** cần chọn một đơn vị chính không? Quản lý trực tiếp gắn theo user hay theo từng membership?
3. **Quy ước Data Scope:** đồng ý quy ước "`X.VIEW` = toàn bộ, thiếu VIEW = liên quan đến tôi" áp dụng thống nhất? Hệ quả với HĐ: bỏ `SALES_CONTRACT.VIEW` khỏi các role nghiệp vụ để Sales/PM chỉ thấy HĐ liên quan, Mua hàng/quản lý giữ VIEW. Việc gỡ grant này là thay đổi quyền thực tế, cần BA duyệt riêng.
4. **Tư cách workflow gắn theo permission:** giữ việc dùng `SALES_CONTRACT.CREATE` làm tiêu chí Sales phụ trách và `PR.CREATE` làm tiêu chí PM phụ trách, hay tách thành key riêng?
5. **Chính sách tài khoản:** độ dài/độ phức tạp mật khẩu, khóa sau N lần sai, bắt đổi mật khẩu khi Admin reset.
6. **`SN_HISTORY.VIEW`:** cần màn hình lịch sử SN riêng với quyền riêng, hay bỏ key khỏi tài liệu?
