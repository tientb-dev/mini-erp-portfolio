# Organization & Authorization · Kiến trúc và đặc tả (OA0)

- **Trạng thái:** **OA0 hoàn thành — kiến trúc đã được BA/Architect duyệt** (ADR-0018 Accepted). Chức năng **chưa triển khai**; từng phần được hiện thực từ OA1 theo §11.
- **Ngày:** 27/11/2026. Branch `feat/organization-authorization`, baseline `f983db0`.
- **Quyết định kiến trúc:** [ADR-0018](decisions/ADR-0018-organization-authorization.md).
- **Hiện trạng chi tiết:** [assessment](../runbooks/organization-authorization-assessment.md).

Mỗi nội dung được gắn một nhãn nguồn gốc:

| Nhãn | Nghĩa |
|---|---|
| **[HT]** | Hiện trạng source code tại baseline |
| **[BA]** | Quyết định đã được BA/Architect duyệt, có mã ở §2 |
| **[ĐX]** | Đề xuất kỹ thuật, chưa được duyệt riêng; không được mâu thuẫn với [BA] |

Mọi câu hỏi Q-01…Q-16 và N-01…N-15 đã đóng (§2.11, §2.12). Các việc kiểm chứng kỹ thuật còn lại chuyển sang phase tương ứng (§14).

## 1. Tóm tắt kiến trúc

1. **[BA]** Giữ RBAC `User → Role → Permission` và `user_warehouses`. Catalog permission do hệ thống định nghĩa. Chỉ Role hệ thống ADMIN được quản trị.
2. **[BA]** Action Permission và Data Scope độc lập. Muốn đọc chứng từ thì **bắt buộc** có permission VIEW và một Data Scope khớp chứng từ đó. Là người tạo, người phụ trách hay người được phân công đều không tự cấp quyền đọc.
3. **[BA]** Organization (cây đơn vị, chức danh, membership) không tự cấp quyền. Đơn vị chỉ có tác dụng khi Admin gán scope `ORG_UNIT` hoặc `ORG_UNIT_TREE` cho một cặp Role–Permission.
4. **[BA]** Candidate Pool gồm Role + User, dùng chung cho 5 nhóm ứng viên. Có permission không đồng nghĩa là ứng viên.
5. **[BA]** `AuthorizationService` là điểm kiểm tra quyền tập trung. Service này nhận `EntityManager` của transaction hiện tại.
6. **[ĐX]** Phiên đăng nhập lưu trong bảng `user_sessions` để thu hồi được từng phiên hoặc toàn bộ phiên (§5.1).
7. **[BA]** Ưu tiên tính đúng của thiết kế mới hơn dữ liệu thử nghiệm cũ. Được dọn chứng từ thử nghiệm sau khi backup và được duyệt (§8).
8. **[BA]** Không xây Rule Engine, Workflow Engine động, Field-level Permission, Delegated Administration, MFA, SSO, HRM hay microservices.

## 2. Danh sách quyết định BA

### 2.1 Organization (ORG)

| Mã | Quyết định |
|---|---|
| BA-ORG-01 | Cây đơn vị nhiều cấp, không giới hạn độ sâu cố định |
| BA-ORG-02 | Chức danh là danh mục độc lập, không tự sinh quyền |
| BA-ORG-03 | Dùng chung hồ sơ User/Employee; tài khoản đăng nhập không bắt buộc |
| BA-ORG-04 | Một nhân sự thuộc nhiều đơn vị; nếu có membership thì có đúng một đơn vị chính |
| BA-ORG-05 | Mỗi nhân sự có một chức danh trên mỗi đơn vị |
| BA-ORG-06 | Người đứng đầu đơn vị và quản lý trực tiếp là hai khái niệm riêng |
| BA-ORG-07 | Quản lý trực tiếp theo membership, không suy diễn từ cây |
| BA-ORG-08 | Không tự cấp quyền theo đơn vị hoặc chức danh |
| BA-ORG-09 | Không xóa vật lý; kiểm soát phụ thuộc khi ngừng hoạt động |
| BA-ORG-10 | Người đứng đầu phải thuộc đơn vị tương ứng (Q-14) |
| BA-ORG-11 | Quản lý trực tiếp phải đang hoạt động khi được chỉ định; không tự quản lý, không tạo vòng lặp (Q-14) |
| BA-ORG-12 | Nhân sự không có tài khoản vẫn giữ được vai trò quản lý tổ chức: người đứng đầu, quản lý trực tiếp (Q-15) |
| BA-ORG-13 | Giữ lịch sử membership đã kết thúc; không lập lịch điều chuyển tương lai (Q-16) |

### 2.2 User & Account (USR)

| Mã | Quyết định |
|---|---|
| BA-USR-01 | Mã nhân viên duy nhất, không tái sử dụng |
| BA-USR-02 | Username duy nhất, không phân biệt hoa thường |
| BA-USR-03 | Phân biệt trạng thái nhân sự và trạng thái tài khoản |
| BA-USR-04 | Ngừng nhân sự thì vô hiệu hóa tài khoản; kích hoạt lại nhân sự không tự kích hoạt tài khoản |
| BA-USR-05 | Mật khẩu tối thiểu 12 ký tự; không bắt buộc ký tự đặc biệt, không đổi định kỳ |
| BA-USR-06 | Bắt buộc đổi mật khẩu khởi tạo và sau khi Admin reset |
| BA-USR-07 | Giới hạn đăng nhập sai; thu hồi token khi đổi hoặc reset mật khẩu |
| BA-USR-08 | Bảo vệ Admin cuối cùng |
| BA-USR-09 | Người dùng chỉ tự sửa Email, Số điện thoại, Mật khẩu |
| BA-USR-10 | Khai báo mã nhân viên cho các tài khoản cần giữ lại; tài khoản demo được tạo lại; không xây cơ chế backfill legacy (Q-01) |
| BA-USR-11 | Sai 5 lần liên tiếp thì khóa 15 phút; ADMIN được mở khóa thủ công (Q-02) |
| BA-USR-12 | Đăng xuất thu hồi phiên hiện tại. Đổi/reset mật khẩu hoặc vô hiệu hóa tài khoản thu hồi toàn bộ phiên (Q-09) |
| BA-USR-13 | Token cũ không có hiệu lực trở lại sau khi kích hoạt lại tài khoản |

### 2.3 Role & Permission (RBAC)

| Mã | Quyết định |
|---|---|
| BA-RBAC-01 | Giữ RBAC User → Role → Permission |
| BA-RBAC-02 | Một User nhiều Role; quyền là hợp các Role đang hoạt động |
| BA-RBAC-03 | Không cấp Permission trực tiếp cho User, không kế thừa Role, không DENY |
| BA-RBAC-04 | Permission Catalog do hệ thống định nghĩa |
| BA-RBAC-05 | Admin tạo và cấu hình Role, không tạo Permission key |
| BA-RBAC-06 | ADMIN là Role hệ thống được bảo vệ, đủ Permission nhưng vẫn tuân thủ Business Rules |
| BA-RBAC-07 | Không hardcode tên Role nghiệp vụ |
| BA-RBAC-08 | Không cho tự nâng quyền |
| BA-RBAC-09 | Thay đổi quyền có hiệu lực từ request tiếp theo |
| BA-RBAC-10 | Chỉ Role hệ thống ADMIN quản trị User, Role, Permission, Organization, Data Scope, Warehouse Grant và Candidate Pool. Không có Delegated Administration; Role thông thường không được cấp Permission quản trị (Q-06) |
| BA-RBAC-11 | Kiểm soát tự thay đổi quyền và bảo vệ Admin cuối cùng (Q-06) |
| BA-RBAC-12 | Thêm `SALES_CONTRACT.CONFIGURE`, giữ `PR.CONFIGURE` (Q-07) |
| BA-RBAC-13 | Cấu hình lại quyền HĐ theo thiết kế mới; không duy trì quyền quá rộng của baseline (Q-04) |

### 2.4 Data Scope (SCP)

| Mã | Quyết định |
|---|---|
| BA-SCP-01 | Tách Action Permission và Data Scope |
| BA-SCP-02 | Data Scope cấu hình theo cặp Role–Permission |
| BA-SCP-03 | Loại scope: toàn bộ, người tạo, người phụ trách, người được phân công, đơn vị của mình, đơn vị và cấp dưới, kho được cấp |
| BA-SCP-04 | Mỗi Permission chỉ hỗ trợ loại Scope phù hợp |
| BA-SCP-05 | Hợp Scope giữa các Role trên cùng Permission; không kết hợp chéo Permission |
| BA-SCP-06 | VIEW toàn cục chuyển thành VIEW có Scope cấu hình |
| BA-SCP-07 | ~~Migration bảo toàn quyền hiện tại~~ → **thay bằng BA-LEG-01…09** (§2.8) |
| BA-SCP-08 | Mỗi chứng từ có tối đa một đơn vị chịu trách nhiệm, lưu lúc tạo |
| BA-SCP-09 | Mặc định đơn vị chính của người tạo; được chọn đơn vị khác mà người tạo đang tham gia |
| BA-SCP-10 | Không tự cập nhật đơn vị của chứng từ cũ khi nhân sự chuyển đơn vị |
| BA-SCP-11 | Không tự kế thừa đơn vị từ chứng từ nguồn |
| BA-SCP-12 | Không gán đơn vị giả cho dữ liệu lịch sử |
| BA-SCP-13 | Scope theo tổ chức xét mọi membership đang hoạt động |
| BA-SCP-14 | List, Detail, Notes, History, File nhất quán |
| BA-SCP-15 | Backend là nguồn kiểm soát chính thức |
| BA-SCP-16 | Giữ `user_warehouses` |
| BA-SCP-17 | Đọc chứng từ bắt buộc VIEW + Scope phù hợp; không cấp quyền đọc ngầm qua người tạo, người phụ trách hoặc người được phân công (Q-03) |
| BA-SCP-18 | Đơn vị chịu trách nhiệm triển khai cho HĐ và PR trước; PO và kho áp dụng ở phase nghiệp vụ tương ứng (Q-05) |

### 2.5 Common Authorization Standard (AUTH)

Áp dụng cho toàn ERP.

| Mã | Quy tắc |
|---|---|
| BA-AUTH-01 | Action Permission và Data Scope độc lập |
| BA-AUTH-02 | Có quyền xem không đồng nghĩa có quyền thao tác, và ngược lại |
| BA-AUTH-03 | Được phân công, tạo hoặc phụ trách chứng từ không tự cấp quyền đọc |
| BA-AUTH-04 | Organization và Job Title không tự cấp quyền |
| BA-AUTH-05 | Hợp Scope giữa Role trên cùng Permission; không kết hợp chéo Permission |
| BA-AUTH-06 | Backend kiểm tra Permission, Data Scope và Business Rules |
| BA-AUTH-07 | Thiếu cấu hình Scope thì từ chối; không mặc định ALL với Permission có Scope cấu hình |
| BA-AUTH-08 | ADMIN vẫn tuân thủ Business Rules |
| BA-AUTH-09 | List, Detail, Notes, History, File và API liên quan nhất quán |
| BA-AUTH-10 | Phân công ứng viên trên chứng từ cụ thể phải kiểm tra cả quyền đọc lẫn quyền xử lý |
| BA-AUTH-11 | UI cảnh báo cấu hình quyền thiếu hoặc mâu thuẫn |
| BA-AUTH-12 | Khi quyền bị thu hồi: giữ phân công và lịch sử, chặn truy cập và thao tác không còn hợp lệ |

### 2.6 Workflow Eligibility (WF)

| Mã | Quyết định |
|---|---|
| BA-WF-01 | Candidate Pool từ User mở rộng sang Role + User |
| BA-WF-02 | Một cơ chế cho Sales phụ trách, PM phụ trách, PR Approve Sales, PR Approve PM, PR Receive |
| BA-WF-03 | Phân biệt người phụ trách nghiệp vụ với người xử lý Workflow |
| BA-WF-04 | Ứng viên phải có trạng thái và Permission phù hợp |
| BA-WF-05 | Eligibility động, loại trùng |
| BA-WF-06 | Không tự phân công theo chức danh hoặc cấp quản lý |
| BA-WF-07 | Không tự phân công lại khi ứng viên mất quyền |
| BA-WF-08 | Giữ quy tắc Workflow PR và Reassign hiện tại |
| BA-WF-09 | Giữ cấu hình ứng viên và phân công hiện có của dữ liệu được giữ lại |
| BA-WF-10 | Role hoặc User phải được cấu hình vào nhóm; có Permission không tự thành ứng viên (Q-11) |
| BA-WF-11 | Nhân sự không có tài khoản không được chọn làm ứng viên xử lý chứng từ (Q-15) |
| BA-WF-12 | Nhóm ứng viên có ID số để tích hợp Common Activity History (Q-08) |

### 2.7 Audit & Security (SEC)

| Mã | Quyết định |
|---|---|
| BA-SEC-01 | Dùng Common Activity History |
| BA-SEC-02 | Ghi before/after cho thay đổi quản trị |
| BA-SEC-03 | Không ghi mật khẩu hoặc hash |
| BA-SEC-04 | Concurrency, version conflict, Admin cuối cùng trong transaction |
| BA-SEC-05 | Rà soát nâng quyền gián tiếp qua Role, Organization, Scope, Warehouse Grant, Candidate Pool |
| BA-SEC-06 | Seed không ghi đè cấu hình quản trị |
| BA-SEC-07 | Không làm mất live grant check và transaction locking của PR |

### 2.8 Dữ liệu legacy (LEG)

| Mã | Quyết định |
|---|---|
| BA-LEG-01 | Ưu tiên đúng thiết kế mới hơn tương thích dữ liệu thử nghiệm |
| BA-LEG-02 | Được xóa chứng từ thử nghiệm HĐ, PR, PO, kho và dữ liệu phụ thuộc nếu cần |
| BA-LEG-03 | Ưu tiên giữ Master Data, User, Role và cấu hình còn phù hợp |
| BA-LEG-04 | Không xây compatibility layer hoặc backfill phức tạp |
| BA-LEG-05 | Không gán dữ liệu giả |
| BA-LEG-06 | Trước khi dọn Dev: backup, xác định phạm vi, báo cáo và chờ duyệt |
| BA-LEG-07 | Không mặc định xóa toàn bộ database |
| BA-LEG-08 | Snapshot quyền trước/sau với dữ liệu giữ lại; phân biệt thay đổi đã duyệt với thay đổi ngoài dự kiến |
| BA-LEG-09 | Kiểm thử đầy đủ quy tắc nghiệp vụ còn hiệu lực |

### 2.9 UI/UX (UI)

| Mã | Quyết định |
|---|---|
| BA-UI-01 | Menu Hệ thống: Cơ cấu tổ chức, Chức danh, Người dùng, Vai trò & Phân quyền, Cấu hình quy trình, Cấu hình hồ sơ chứng từ |
| BA-UI-02 | Cơ cấu tổ chức: Tree View + Detail Panel; tab Thông tin chung, Nhân sự, Lịch sử; không drag-drop |
| BA-UI-03 | Chức danh: Common Master Data List + FormDialog; không ngừng khi còn nhân sự hoạt động sử dụng |
| BA-UI-04 | Người dùng: Full Page; tab Thông tin chung, Tổ chức, Vai trò, Phạm vi dữ liệu, Lịch sử; không Copy User; lưu tập trung; thao tác bảo mật tách riêng |
| BA-UI-05 | Vai trò & Phân quyền: Full Page; tab Thông tin chung, Phân quyền, Người dùng, Lịch sử; nhóm theo module, Scope cạnh Permission; không cấp toàn bộ hàng loạt; Copy Role không sao chép User hoặc Candidate Pool |
| BA-UI-06 | Cấu hình quy trình: hai panel; Role + User; ứng viên thực tế và lý do không đủ điều kiện |
| BA-UI-07 | Hồ sơ cá nhân từ menu tài khoản; đổi mật khẩu bằng FormDialog; bắt buộc đổi mật khẩu bằng màn hình riêng |
| BA-UI-08 | Dùng Common UI, Validation, Picker, ActionResult, Activity History |
| BA-UI-09 | Membership và User–Role từ hai phía dùng chung API và quy tắc |
| BA-UI-10 | Ưu tiên component hiện có, không thêm dependency không cần thiết (Q-12) |
| BA-UI-11 | UI triển khai cùng từng phase backend; OA5 chỉ hoàn thiện UX còn lại (Q-13) |
| BA-UI-12 | Màn hình bắt buộc đổi mật khẩu triển khai cùng cơ chế backend |

### 2.10 Phạm vi và roadmap (SCOPE)

| Mã | Quyết định |
|---|---|
| BA-SCOPE-01 | Phân loại P1 nền tảng, P2 hoàn thiện, P3 tương lai |
| BA-SCOPE-02 | Không Workflow Engine động, Rule Engine, Field-level Permission, HRM, MFA, SSO, microservices, Delegated Administration |
| BA-SCOPE-03 | Organization & Authorization hoàn thành trước HĐ, PR, PO, kho |
| BA-SCOPE-04 | Roadmap tuần tự OA0 → OA7 (§11) |
| BA-SCOPE-05 | `SN_HISTORY.VIEW` xử lý ở phase kho (Q-10) |

### 2.11 Truy vết Q-01…Q-16 (đã đóng)

| Q | Đóng bởi | Q | Đóng bởi |
|---|---|---|---|
| Q-01 | BA-USR-10 | Q-09 | BA-USR-12 |
| Q-02 | BA-USR-11 | Q-10 | BA-SCOPE-05 |
| Q-03 | BA-SCP-17, BA-AUTH-03 | Q-11 | BA-WF-10 |
| Q-04 | BA-RBAC-13 | Q-12 | BA-UI-10 |
| Q-05 | BA-SCP-18 | Q-13 | BA-UI-11 |
| Q-06 | BA-RBAC-10, BA-RBAC-11 | Q-14 | BA-ORG-10, BA-ORG-11 |
| Q-07 | BA-RBAC-12 | Q-15 | BA-WF-11, BA-ORG-12 |
| Q-08 | BA-WF-12 | Q-16 | BA-ORG-13 |

### 2.12 Quyết định review cuối (N-01…N-15)

| Mã | Quyết định |
|---|---|
| BA-N-01 | Giữ `SALES_CONTRACT.CREATE`/`PR.CREATE` làm process permission của nhóm Sales/PM phụ trách; OA4 kiểm tra đúng đối tượng áp dụng Scope |
| BA-N-02 | Tách quản trị hệ thống với quản lý nghiệp vụ. `PR.REASSIGN`, `PR.DOSSIER_MANAGE`, `DOSSIER_TYPE.VIEW` **không** `admin_only`. `DOSSIER_TYPE.MANAGE`, `DOSSIER_CONFIG.MANAGE` là `admin_only`. Cấu hình nhóm ứng viên tách khỏi phân công nhân sự trên chứng từ |
| BA-N-03 | Chặn lưu Role khi Permission yêu cầu Scope mà chưa chọn Scope; runtime vẫn fail-closed |
| BA-N-04 | Kiểm chứng SQL và transaction locking trên PostgreSQL tại OA1 |
| BA-N-05 | Chặn kết thúc membership của người đứng đầu cho đến khi đổi hoặc bỏ người đứng đầu |
| BA-N-06 | Phải đổi hoặc bỏ quan hệ người đứng đầu và quản lý trực tiếp trước khi ngừng nhân sự |
| BA-N-07 | Ngừng nhân sự giữ nguyên membership; nhân sự inactive không có quyền hiệu lực |
| BA-N-08 | Được tạo chứng từ khi không thuộc đơn vị nếu Permission, Scope và Business Rules cho phép (đơn vị = NULL) |
| BA-N-09 | Ghi sự kiện đăng nhập thành công/thất bại và sự kiện bảo mật; không ghi bí mật; không có màn phân tích đăng nhập |
| BA-N-10 | Thông báo xác thực thất bại thống nhất, không lộ tồn tại hay đang khóa; ADMIN xem trạng thái khóa ở quản lý người dùng |
| BA-N-11 | ADMIN không tự thay đổi membership của mình, kiểm soát trên mọi API liên quan |
| BA-N-12 | Gỡ `PUT /pr-workflow/routes/:route` khi chức năng thay thế hoàn chỉnh tại OA4 |
| BA-N-13 | BA duyệt ma trận quyền khởi tạo trước khi áp dụng OA3 |
| BA-N-14 | Dọn Activity History bằng script bảo trì Dev/Test có kiểm soát; không có API xóa lịch sử |
| BA-N-15 | Tài khoản demo đăng nhập tương tác phải đổi mật khẩu lần đầu; fixture automated test chuẩn bị riêng, không có ngoại lệ runtime |

### 2.13 Finding cuối OA0 (F-OA0)

| Mã | Quyết định |
|---|---|
| F-OA0-01 | Đổi mật khẩu (thường hoặc bắt buộc) thu hồi **toàn bộ** session kể cả phiên hiện tại, không cấp token mới, thành công thì về màn đăng nhập |
| F-OA0-02 | Eligibility đánh giá ASSIGNED/RESPONSIBLE trên **trạng thái dự kiến sau phân công**; không tạo điều kiện vòng tròn; quyền thực tế chỉ phát sinh sau khi phân công lưu thành công; Permission phải đúng loại chứng từ |
| F-OA0-03 | CREATE đánh giá Permission, Scope và quyền đọc trên trạng thái chứng từ dự kiến tạo, không cần ID; kiểm tra lại trong transaction lưu |
| F-OA0-04 | OA1 nghiệm thu concurrency: login đồng thời reset/disable, đổi mật khẩu đồng thời, nhiều lần sai đồng thời; không tạo session bằng thông tin xác thực đã mất hiệu lực |
| F-OA0-05 | Backend và UI `owner_org_unit_id` của HĐ/PR thuộc OA3; nghiệm thu đủ ORG_UNIT, ORG_UNIT_TREE tại OA3 |
| F-OA0-06 | Khôi phục đầy đủ UI đã duyệt (§9); không tự giản lược |
| F-OA0-07 | AuthorizationService dùng chung nhưng Business Rules thuộc từng phân hệ. Không áp "chỉ người tạo được sửa" cho toàn ERP. HĐ Draft: người tạo hoặc Sales phụ trách thao tác nếu đủ quyền và thỏa Business Rules đã duyệt. Giữ quy tắc PR đã chốt |

### 2.14 Quyết định OA3.0 (Data Scope review)

| Mã | Quyết định |
|---|---|
| BA-OA3-01 | Giữ supported scopes theo §7, gồm G/O/T/A cho `PR.APPROVE`, `PR.RECEIVE` |
| BA-OA3-02 | ADMIN nhận ALL nếu permission hỗ trợ ALL; nếu không, nhận toàn bộ supported scopes. Không ngoại lệ trigger, không bypass Business Rule |
| BA-OA3-03 | Ma trận grant khởi tạo §7.1 (BA-N-13). Không tự cấp O/T cho trưởng bộ phận. Gỡ quyền HĐ khỏi COMMON |
| BA-OA3-04 | ASSIGNED gồm lịch sử phân công; quyền xử lý vẫn yêu cầu đúng người đang được giao |
| BA-OA3-05 | Permission và Scope độc lập; hợp scope chỉ trong cùng permission; grant thiếu scope không làm mất grant hợp lệ từ Role khác |
| BA-OA3-06 | Đơn vị chịu trách nhiệm: đã có membership thì phải chọn đơn vị (mặc định đơn vị chính), không sửa sau khi tạo; NULL chỉ khi không có membership (D-05) |
| BA-OA3-07 | Có VIEW nhưng ngoài scope → 404 như ID không tồn tại; không có VIEW → 403 (D-06) |
| BA-OA3-08 | Duyệt D-09 (sửa H-01 bằng scope `SALES_CONTRACT.CREATE` + Business Rule người tạo/Sales phụ trách), D-10 (kho được cấp chỉ đọc trên Hồ sơ cá nhân), D-12 (tab PR trên HĐ ở OA3; Notes/History/File HĐ ở OA6) |
| BA-OA3-09 | PO/kho chưa có scope mới ở OA3 (`supported_scopes = '{}'`), nhưng OA3.3 phải chặn các đường bypass dữ liệu HĐ/PR (rà F08, F09, F11, F12 của OA3.0) |
| BA-OA3-10 | Migration: không compatibility layer, không backfill dữ liệu giả; chuyển grant bằng mapping được duyệt có dry-run và snapshot; không suy diễn quyền cho Role tùy chỉnh; dọn dữ liệu không phù hợp theo phạm vi BA duyệt riêng trước khi tác động Dev |

## 3. Xử lý mâu thuẫn tài liệu

| Tài liệu | Nội dung cũ | Xử lý |
|---|---|---|
| [01-MVP-SCOPE §4](../01-MVP-SCOPE.md) | Phân quyền phòng ban nằm ngoài phạm vi | Đã sửa: phạm vi theo đơn vị là Data Scope cấu hình được |
| [ADR-0006](decisions/ADR-0006-permission-model.md) | Không phân quyền phòng ban; "người tạo luôn xem chứng từ của mình"; VIEW toàn cục | Một phần được thay thế bởi ADR-0018. Ngoại lệ "người tạo luôn xem" **bị bỏ** (BA-AUTH-03) |
| [ADR-0014](decisions/ADR-0014-scoped-pr-read-for-responsible-sales.md) | Sales phụ trách đọc PR qua `SALES_CONTRACT.VIEW` mà không cần `PR.VIEW` | **Bị thay thế.** Muốn đọc phải có `PR.VIEW` scope `RESPONSIBLE` (BA-SCP-17) |
| [ADR-0015](decisions/ADR-0015-purchase-requisition-workflow.md) | Pool chỉ có User. Người có PR.CREATE/APPROVE/RECEIVE đọc PR liên quan dù không có `PR.VIEW` | Pool thành Role + User. Đọc ngầm **bị bỏ**. Quy tắc workflow và Reassign giữ nguyên (BA-WF-08) |
| [04-PERMISSIONS](../04-PERMISSIONS.md) §1, §2 | "người tạo luôn xem"; dòng Sales trỏ ADR-0014; "người được giao thấy chứng từ cần mình xử lý" | Thêm ghi chú baseline. Bảng quyền viết lại ở OA3 |
| ARCHITECTURE §6 | "Người tạo luôn xem được chứng từ của mình" | Thêm ghi chú: bị thay bởi ADR-0018 |
| Bản OA0 trước, §8 | "Bảo toàn quyền truy cập hiện tại, snapshot phải giống hệt" | Thay bằng BA-LEG: snapshot có phân loại khác biệt (§8) |
| Bản OA0 trước, §5.1 | Chỉ dùng `token_version` | Thay bằng `user_sessions` (§5.1) |
| Bản OA0 trước, §5.4 | Delegated admin ("gán Role nằm trong quyền mình") | Bỏ (BA-RBAC-10) |

## 4. Mô hình dữ liệu [ĐX]

Migration thêm schema mới, không đổi mã permission đang có. Gỡ grant quá rộng và dọn chứng từ thử nghiệm làm theo §8, không lẳng lặng trong migration.

### 4.1 Identity

```sql
-- users (hiện có): hồ sơ nhân sự + tài khoản tùy chọn
+ employee_code        varchar(50) NOT NULL                         -- BA-USR-01, BA-USR-10
+ email, phone         NULL
+ employment_status    text NOT NULL DEFAULT 'ACTIVE' CHECK (IN 'ACTIVE','INACTIVE')
  is_active            -- giữ; nghĩa là "tài khoản đang hoạt động"
  username, password_hash  -- cho phép NULL (không có tài khoản)
+ must_change_password boolean NOT NULL DEFAULT false
+ password_changed_at  timestamptz NULL
+ failed_login_count   int NOT NULL DEFAULT 0
+ locked_until         timestamptz NULL
+ version int NOT NULL DEFAULT 1, created_at, updated_at, updated_by
CHECK ((username IS NULL) = (password_hash IS NULL))
CHECK (employment_status = 'ACTIVE' OR NOT is_active)              -- BA-USR-04
CHECK (username IS NOT NULL OR NOT is_active)
UNIQUE (lower(username)) WHERE username IS NOT NULL                 -- BA-USR-02
UNIQUE (lower(employee_code))

-- MỚI: phiên đăng nhập (BA-USR-12, BA-USR-13)
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY,                   -- = claim `sid` trong JWT
  user_id int NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,       -- = exp của JWT
  revoked_at timestamptz NULL,
  revoke_reason text NULL CHECK (IN 'LOGOUT','PASSWORD_CHANGED','PASSWORD_RESET','ACCOUNT_DISABLED','EMPLOYMENT_INACTIVE'));
INDEX ON user_sessions (user_id) WHERE revoked_at IS NULL;
```

- `employee_code` là NOT NULL. Vì vậy migration OA2 chỉ chạy được khi mọi user được giữ lại đã có mã: Admin khai báo trước, còn tài khoản demo thì xóa và tạo lại (BA-USR-10). Migration **dừng** nếu còn user thiếu mã. Không tự sinh mã.
- Kiểm tra trùng `lower(username)` trước khi tạo unique index. Có trùng thì dừng.

```sql
-- roles (hiện có)
+ description, is_active boolean DEFAULT true, is_system boolean DEFAULT false, version, audit cols
UNIQUE (lower(code))

-- permissions (hiện có): catalog đồng bộ bằng migration
+ module varchar(50) NOT NULL, name varchar(200) NOT NULL, description text   -- OA1.1
+ sort_order int                                                              -- OA1.3
+ supported_scopes text[] NOT NULL          -- '{}' = permission không phân scope
+ admin_only boolean NOT NULL DEFAULT false -- BA-RBAC-10
CHECK (NOT admin_only OR supported_scopes = '{}')

-- MỚI
CREATE TABLE role_permission_scopes (
  role_id int, permission_id int,
  scope_type text NOT NULL CHECK (IN 'ALL','CREATOR','RESPONSIBLE','ASSIGNED','ORG_UNIT','ORG_UNIT_TREE','WAREHOUSE'),
  PRIMARY KEY (role_id, permission_id, scope_type),
  FOREIGN KEY (role_id, permission_id) REFERENCES role_permissions ON DELETE CASCADE);
```

**Quy tắc grant**, kiểm tra trong service và bằng trigger `BEFORE INSERT/UPDATE` để chặn cả SQL tay:

- **Permission không phân scope** (`supported_scopes = '{}'`), ví dụ Master Data hay quản trị: grant không có dòng scope.
- **Permission có scope:** lưu Role bị **chặn** khi permission chưa chọn scope (BA-N-03). Runtime vẫn fail-closed: grant không có dòng scope (ví dụ do SQL tay) thì bị từ chối (BA-AUTH-07).
- `scope_type` phải nằm trong `supported_scopes`.
- Permission `admin_only` chỉ được gán cho Role `is_system` (BA-RBAC-10).

### 4.2 Grant hiệu lực

```sql
CREATE VIEW v_user_grants AS
SELECT u.id AS user_id, r.id AS role_id, r.name AS role_name, p.id AS permission_id, p.code AS permission
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id AND r.is_active
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p ON p.id = rp.permission_id
 WHERE u.is_active AND u.employment_status = 'ACTIVE' AND u.username IS NOT NULL;
```

**Đánh giá trên PostgreSQL:**

- View thường, không materialized. Planner inline nó vào query, nên chi phí bằng JOIN viết tay. Không có độ trễ cập nhật, và đáp ứng BA-RBAC-09.
- Dùng view cho đường **đọc**: nạp quyền mỗi request, danh sách ứng viên, effective access.
- Đường **khóa live** (BA-SEC-07) không dựa vào view.
  - PostgreSQL áp mệnh đề `FOR SHARE` trên view lên mọi bảng bên trong, kể cả `permissions`. Khóa như vậy rộng hơn cần và khó kiểm soát thứ tự khóa.
  - `AuthorizationService.lockGrant(em, userId, permission)` viết JOIN trên bảng gốc với `FOR SHARE OF u, ur, r, rp`. Thêm `r` so với [HT], để việc ngừng Role không chạy đua với action PR.
  - Hàm nằm cạnh định nghĩa view trong cùng module. Test bắt buộc hai cách cho cùng kết quả.
- SQL và locking (view, `lockGrant`, admin-guard, session) được kiểm chứng trên PostgreSQL tại OA1 (BA-N-04).

### 4.3 Organization

```sql
CREATE TABLE org_units (
  id serial PRIMARY KEY, code varchar(50) NOT NULL, name varchar(200) NOT NULL,
  parent_id int NULL REFERENCES org_units(id) CHECK (parent_id <> id),
  head_user_id int NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'ACTIVE', description text, version int NOT NULL DEFAULT 1, audit cols);
UNIQUE (lower(code)); INDEX (parent_id);

CREATE TABLE job_titles (id serial PRIMARY KEY, code, name, status, description, version, audit cols);
UNIQUE (lower(code));

CREATE TABLE org_memberships (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id),
  org_unit_id int NOT NULL REFERENCES org_units(id),
  job_title_id int NOT NULL REFERENCES job_titles(id),
  manager_user_id int NULL REFERENCES users(id) CHECK (manager_user_id <> user_id),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (IN 'ACTIVE','ENDED'),
  started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz NULL,
  CHECK ((status = 'ENDED') = (ended_at IS NOT NULL)),
  version int NOT NULL DEFAULT 1, audit cols);
UNIQUE (user_id, org_unit_id) WHERE status = 'ACTIVE';
UNIQUE (user_id) WHERE status = 'ACTIVE' AND is_primary;
INDEX (org_unit_id) WHERE status = 'ACTIVE';
```

| Quy tắc | Kiểm soát |
|---|---|
| Đúng một đơn vị chính (BA-ORG-04) | Partial unique (≤ 1). Service kiểm ≥ 1 dưới khóa `users` row, trước khi commit |
| Head thuộc đơn vị (BA-ORG-10) | Khi gán head: có membership ACTIVE tại đơn vị. Kết thúc membership của head bị chặn cho đến khi đổi hoặc bỏ head (BA-N-05) |
| Manager (BA-ORG-11) | Lúc chỉ định, manager có nhân sự ACTIVE; không tự quản lý (CHECK). Không tạo vòng: dưới advisory lock `org-tree` (closure F05; trước đây `org-manager`), CTE đi ngược chuỗi manager qua membership ACTIVE, không được gặp `user_id`. Manager không cần có tài khoản (BA-ORG-12) |
| Ngừng nhân sự là head/manager | Chặn cho đến khi đổi hoặc bỏ mọi quan hệ head và manager trỏ tới người đó (BA-N-06) |
| Vòng lặp cây | Advisory lock `org-tree` + CTE kiểm tra parent mới không thuộc cây con |
| Ngừng đơn vị | Chặn khi còn đơn vị con ACTIVE hoặc membership ACTIVE |
| Trạng thái theo cây (BA xác nhận tại OA2.2) | Không có đơn vị ACTIVE nằm dưới đơn vị INACTIVE: tạo/chuyển chỉ vào cha ACTIVE, kích hoạt chỉ khi cha ACTIVE, ngừng khi không còn con ACTIVE |
| Ngừng chức danh (BA-UI-03) | Chặn khi còn membership ACTIVE của nhân sự ACTIVE dùng chức danh đó |
| Lịch sử (BA-ORG-13) | Kết thúc membership là `status = ENDED` + `ended_at`, không xóa. Không có ngày hiệu lực tương lai |
| Ngừng nhân sự | Membership giữ nguyên (BA-N-07). `v_user_grants` loại nhân sự inactive nên không có quyền hiệu lực |

Scope `ORG_UNIT_TREE` lấy cây con bằng CTE đệ quy, tính một lần mỗi request. `shortcut:` CTE mỗi request; chuyển sang closure table khi đo được chậm.

### 4.4 Đơn vị chịu trách nhiệm trên chứng từ

- `sales_contracts.owner_org_unit_id` và `purchase_requisitions.owner_org_unit_id`: `int NULL REFERENCES org_units(id)`, có index (BA-SCP-18).
- Khi tạo:
  - Mặc định là đơn vị chính của người tạo. Được chọn đơn vị ACTIVE khác mà người tạo đang có membership ACTIVE.
  - Backend kiểm tra trong transaction.
  - Người tạo không có membership thì giá trị là NULL; vẫn được tạo nếu Permission, Scope và Business Rules cho phép (BA-N-08, BA-LEG-05).
- Không cập nhật lại khi membership đổi (BA-SCP-10). Không kế thừa từ chứng từ nguồn (BA-SCP-11).
- Giá trị NULL không bao giờ khớp scope ORG. Chứng từ thử nghiệm cũ để NULL hoặc bị dọn (§8). Không gán đơn vị giả.

### 4.5 Nhóm ứng viên

```sql
CREATE TABLE workflow_candidate_groups (
  id serial PRIMARY KEY,                       -- BA-WF-12
  code text NOT NULL UNIQUE,                   -- hệ thống định nghĩa
  document_type text NOT NULL,                 -- SALES_CONTRACT | PR
  process_permission text NOT NULL REFERENCES permissions(code),
  configure_permission text NOT NULL REFERENCES permissions(code),
  name text NOT NULL, version int NOT NULL DEFAULT 1);

CREATE TABLE workflow_candidate_members (
  id serial PRIMARY KEY,
  group_id int NOT NULL REFERENCES workflow_candidate_groups(id),
  role_id int NULL REFERENCES roles(id), user_id int NULL REFERENCES users(id),
  CHECK ((role_id IS NULL) <> (user_id IS NULL)), created_at, created_by);
UNIQUE (group_id, role_id) WHERE role_id IS NOT NULL;
UNIQUE (group_id, user_id) WHERE user_id IS NOT NULL;
```

| Nhóm | Process permission | Configure permission |
|---|---|---|
| `SC_RESPONSIBLE_SALES` | `SALES_CONTRACT.CREATE` (BA-N-01) | `SALES_CONTRACT.CONFIGURE` |
| `SC_RESPONSIBLE_PM` | `PR.CREATE` (BA-N-01) | `SALES_CONTRACT.CONFIGURE` |
| `PR_APPROVE_SALES` | `PR.APPROVE` | `PR.CONFIGURE` |
| `PR_APPROVE_PM` | `PR.APPROVE` | `PR.CONFIGURE` |
| `PR_RECEIVE` | `PR.RECEIVE` | `PR.CONFIGURE` |

**Tách hai mức eligibility (BA-AUTH-10):**

1. **Ứng viên của nhóm** (màn Cấu hình quy trình) gồm những user thỏa đồng thời:
   - là thành viên của nhóm, trực tiếp hoặc qua một Role ACTIVE là thành viên;
   - có tài khoản active và nhân sự active (BA-WF-11);
   - có `process_permission` qua `v_user_grants`.
   Kết quả loại trùng theo `user_id`.
2. **Ứng viên trên chứng từ cụ thể:** là (1), cộng thêm:
   - scope của `process_permission` khớp chứng từ;
   - `X.VIEW` có scope khớp chứng từ, với X là **đúng loại chứng từ** của permission;
   - các Business Rules, ví dụ không phải người tạo.

   **Đánh giá trên trạng thái dự kiến** (F-OA0-02). Scope ASSIGNED và RESPONSIBLE được tính như thể ứng viên đã được lưu vào phân công hoặc vai trò phụ trách. Nhờ vậy không có vòng tròn kiểu "phải được giao mới đọc được, phải đọc được mới được giao". Quyền truy cập thực tế chỉ phát sinh sau khi phân công commit. Lưu phân công kiểm tra lại trong cùng transaction.

   **Cấu hình nhóm** (Admin, `configure_permission`) tách khỏi **phân công trên chứng từ** (người dùng nghiệp vụ, theo Business Rules của phân hệ) (BA-N-02).

Lý do loại có mã: `NO_ACCOUNT`, `ACCOUNT_INACTIVE`, `EMPLOYMENT_INACTIVE`, `ROLE_INACTIVE`, `MISSING_PERMISSION`, `MISSING_SCOPE`, `MISSING_READ_SCOPE`, `IS_CREATOR`.

### 4.6 Activity History

- Mở rộng `chk_activity_target` thêm `USER`, `ROLE`, `ORG_UNIT`, `JOB_TITLE`, `WORKFLOW_GROUP`, dùng `id` số.
- `metadata = {before, after}` theo danh sách trường được phép của từng target. Không serialize entity, nên không lọt hash (BA-SEC-03).
- Sự kiện bảo mật (BA-N-09): login thành công, login thất bại, khóa, mở khóa, reset, đổi mật khẩu, thu hồi phiên. Ghi vào Activity của target USER khi username khớp một user; không ghi mật khẩu, hash, token, `sid`. Login thất bại với username không tồn tại không có target nên không ghi. Không có màn phân tích đăng nhập.

## 5. Authorization runtime [ĐX]

### 5.1 Phiên và token

- JWT gồm `{sub, sid, exp}`. Login tạo một dòng `user_sessions`.
- Guard hiện đã nạp user mỗi request [HT]. Mở rộng query này để đọc thêm session `sid`: chưa revoke, chưa hết hạn, thuộc `sub`. Session không hợp lệ thì trả 401. Không thêm round-trip DB.
- **Đăng xuất:** revoke `sid` hiện tại (`LOGOUT`).
- **Thu hồi toàn bộ:** `UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, chạy trong cùng transaction với đổi mật khẩu, reset, vô hiệu hóa tài khoản hoặc ngừng nhân sự.
- **Kích hoạt lại** tài khoản không mở lại session nào (BA-USR-13). Token cũ vẫn bị từ chối vì session đã revoke. Session hết hạn cũng bị từ chối. Không cần `token_version`.
- **Đổi mật khẩu** (thường hoặc bắt buộc) thu hồi **toàn bộ** session kể cả phiên hiện tại, không cấp token mới; web chuyển về màn đăng nhập (F-OA0-01).
- **Không tạo session bằng thông tin đã mất hiệu lực** (F-OA0-04): login khóa dòng `users` `FOR UPDATE`, kiểm mật khẩu, trạng thái và lockout trên dòng đã khóa, rồi INSERT session trong cùng transaction. Reset, disable, đổi mật khẩu cũng khóa dòng `users` trước khi revoke. Hai phía được tuần tự hóa: login commit trước thì session bị revoke ngay sau; reset commit trước thì login thấy hash mới và thất bại.
- Dọn session hết hạn: job định kỳ, có thể gộp vào job dọn hằng giờ của dossier [HT].
- `must_change_password`: guard chỉ cho `GET /auth/me`, `POST /auth/change-password`, `POST /auth/logout`; còn lại trả 403 `PASSWORD_CHANGE_REQUIRED`.

### 5.2 Đăng nhập (BA-USR-11)

- So khớp `lower(username)`. Tài khoản đang khóa (`locked_until > now()`) thì từ chối mà không kiểm mật khẩu.
- Sai mật khẩu: một câu `UPDATE … SET failed_login_count = failed_login_count + 1, locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN now() + interval '15 minutes' END … RETURNING`, atomic.
- Đúng mật khẩu thì đếm về 0. Hết khóa thì bộ đếm cũng về 0 (đếm "liên tiếp").
- ADMIN mở khóa thủ công: đặt `locked_until = NULL`, đếm về 0, ghi Activity.
- Thông báo thất bại thống nhất cho mọi trường hợp: không tồn tại, sai mật khẩu, khóa, tắt (BA-N-10). ADMIN xem trạng thái khóa ở quản lý người dùng.
- Nhiều lần sai đồng thời: bộ đếm tăng trên dòng đã khóa nên không mất lượt (F-OA0-04).

### 5.3 AuthorizationService

```ts
interface AuthorizationService {
  load(em, userId, sessionId): CurrentUser                  // grants + scopes + warehouses
  has(user, permission): boolean
  scopeFilter(user, permission, cols: ScopeColumns): { sql, params } | null  // null ⇒ deny
  assertCanRead(em, user, docType, id): Promise<void>        // cùng điều kiện với list
  lockGrant(em, userId, permission): Promise<Grant | null>   // FOR SHARE, live
  candidates(em, groupCode, doc?): Promise<Candidate[]>      // §4.5 kèm lý do loại
}
```

- Mọi hàm nhận `em` của transaction gọi, để kiểm tra và ghi nằm trong cùng snapshot và khóa.
- `ScopeColumns` do module sở hữu khai báo, không phải rule engine:

| Scope | Điều kiện |
|---|---|
| ALL | `TRUE` |
| CREATOR | `{creator} = :uid` |
| RESPONSIBLE | `:uid IN ({responsible…})`. HĐ: Sales/PM phụ trách; PR: Sales/PM phụ trách của HĐ nguồn |
| ASSIGNED | `EXISTS` node workflow có `assignee_id = :uid` (đang hoặc đã) |
| ORG_UNIT | `{owner_org_unit} = ANY(:units)` (mọi membership ACTIVE) |
| ORG_UNIT_TREE | `{owner_org_unit} = ANY(:unitsAndDescendants)` |
| WAREHOUSE | `{warehouse} = ANY(:warehouseIds)` |

- Kết quả là OR các scope của chính permission đó (BA-AUTH-05). Không có scope nào thì trả `null`, tức từ chối (BA-AUTH-07).
- Module không khai báo cột cho một scope thì scope đó không được nằm trong `supported_scopes`. Test kiểm điều này.
- **Thao tác trên chứng từ:** cần permission hành động và scope khớp chứng từ, **cộng** quyền đọc (`X.VIEW` + scope), rồi mới đến Business Rules (BA-AUTH-02, BA-AUTH-06).
- **CREATE** (F-OA0-03): chưa có ID. Service dựng trạng thái dự kiến (người tạo, đơn vị chịu trách nhiệm, người phụ trách, kho) và đánh giá permission, scope, quyền đọc trên đó bằng cùng predicate (`canAccessDraft`). Kiểm tra lại trong transaction lưu.
- **Business Rules thuộc từng phân hệ** (F-OA0-07), không thành scope. `AuthorizationService` dùng chung nhưng không chứa rule nghiệp vụ. Không có quy tắc "chỉ người tạo được sửa" cho toàn ERP. Ví dụ hiện hành:
  - người tạo không tự duyệt;
  - HĐ Draft: người tạo hoặc Sales phụ trách thao tác nếu đủ quyền và thỏa Business Rules đã duyệt;
  - PR, PO, kho: giữ quy tắc người tạo đã chốt của từng phân hệ;
  - bước 1 GIR là Sales nguồn;
  - chỉ HĐ ACTIVE làm nguồn PR;
  - người tạo PR phải là người phụ trách HĐ;
  - Sales phụ trách khóa sau khi chốt;
  - chỉ người được giao bước hiện tại mới xử lý bước đó.

  Các invariant này **giới hạn thêm**, không bao giờ cấp quyền đọc (BA-AUTH-03).
- **Khi quyền bị thu hồi** (BA-AUTH-12): `assignee_id`, người phụ trách và lịch sử giữ nguyên. Mọi request sau bị chặn. PR dùng Reassign [HT]. Chứng từ PO và kho không có Reassign nên sẽ kẹt (H-07); xử lý ở phase nghiệp vụ của chúng.

### 5.4 Chống nâng quyền (BA-RBAC-08, BA-RBAC-10, BA-SEC-05)

| Đường | Kiểm soát |
|---|---|
| Permission quản trị | `admin_only`, chỉ gán được cho Role `is_system` (ADMIN): `USER.*`, `ROLE.*`, `ORGANIZATION.*`, `SALES_CONTRACT.CONFIGURE`, `PR.CONFIGURE`, `DOSSIER_TYPE.MANAGE`, `DOSSIER_CONFIG.MANAGE`. **Không** `admin_only`: `PR.REASSIGN`, `PR.DOSSIER_MANAGE`, `DOSSIER_TYPE.VIEW` (BA-N-02) |
| Tự thay đổi | ADMIN không tự gỡ Role, tự vô hiệu hóa tài khoản, tự ngừng nhân sự, tự thay đổi membership hay kho của mình (BA-N-11). Chặn trên mọi API: lưu User, membership, tab Nhân sự của đơn vị, tab Người dùng của Role. Mã `SELF_CHANGE_DENIED` |
| Role ADMIN | `is_system`: không đổi mã, không ngừng, không gỡ permission. Permission mới tự cấp cho ADMIN trong migration thêm key |
| Organization | Chỉ ADMIN sửa. Đổi membership làm đổi scope ORG nên ghi Activity before/after |
| Scope | Chỉ ADMIN; trigger chặn scope ngoài `supported_scopes` |
| Warehouse Grant | Chỉ ADMIN; ghi Activity |
| Candidate Pool | Chỉ ADMIN. Vào nhóm **không** cấp permission hay scope. Ứng viên trên chứng từ vẫn qua BA-AUTH-10 |
| Seed | Không ghi grant trên DB đã có cấu hình (§8.4) |
| Role không active | Loại khỏi grant, ứng viên, scope từ request tiếp theo |

### 5.5 Bảo vệ Admin cuối cùng (BA-USR-08, BA-SEC-04)

- **Bất biến:** còn ít nhất một user thỏa đồng thời: tài khoản active, nhân sự active, `locked_until` không xét, giữ Role `is_system`.
- **Mọi đường có thể phá bất biến:**
  - vô hiệu hóa tài khoản;
  - ngừng nhân sự;
  - gỡ Role (lưu User, tab Người dùng của Role);
  - xóa tài khoản khỏi nhân sự (chuyển sang không có tài khoản);
  - đổi username về NULL.
- Mỗi đường lấy `pg_advisory_xact_lock(hashtext('admin-guard'))` trước khi khóa dòng `users`, áp thay đổi, đếm lại, rồi rollback `LAST_ADMIN` nếu kết quả là 0. Thứ tự khóa cố định: admin-guard → users (theo id tăng dần) → roles.
- Hai request đồng thời gỡ hai Admin cuối bị tuần tự hóa nhờ advisory lock, nên request sau thấy kết quả 0 và bị chặn.

### 5.6 Concurrency

- Entity quản trị có `version`. PUT nhận `version`, không khớp thì trả 409 `VERSION_CONFLICT`.
- Lưu User tập trung (BA-UI-04) là một transaction gồm hồ sơ, membership, roles, kho. Lấy admin-guard nếu có đổi Role hoặc trạng thái.
- Ứng viên trên PR: giữ advisory lock pool và `FOR SHARE` [HT], đổi sang `lockGrant` (§4.2).

## 6. API [ĐX]

Mọi `/admin/*` yêu cầu permission `admin_only` tương ứng (chỉ ADMIN). Danh sách dùng Common List query.

| Method · Path | Quyền | Ghi chú |
|---|---|---|
| `POST /auth/login` | public | §5.2; tạo session |
| `POST /auth/logout` | đăng nhập | Revoke `sid` |
| `POST /auth/change-password` | đăng nhập | Cần mật khẩu cũ; revoke toàn bộ kể cả phiên hiện tại; không trả token (F-OA0-01) |
| `GET /auth/me`, `PATCH /me` | đăng nhập | PATCH chỉ nhận `email`, `phone`, `version` |
| `GET /admin/permissions` | `ROLE.VIEW` | Theo module, `supportedScopes`, `adminOnly` |
| `GET/POST /admin/roles`, `GET/PUT /admin/roles/:id` | `ROLE.VIEW` / `ROLE.MANAGE` | PUT `{info, grants:[{permission, scopes[]}], version}`; trả kèm `warnings` (BA-AUTH-11) |
| `POST /admin/roles/:id/copy` | `ROLE.MANAGE` | Chỉ permission và scope |
| `PATCH /admin/roles/:id/status` | `ROLE.MANAGE` | Chặn với `is_system` |
| `GET /admin/roles/:id/users` | `ROLE.VIEW` | |
| `GET/POST /admin/users`, `GET/PUT /admin/users/:id` | `USER.VIEW` / `USER.MANAGE` | Lưu tập trung `{profile, memberships[], roleIds[], warehouseIds[], version}`; POST nhận thêm `account?: {username, initialPassword}` để tạo tài khoản khởi tạo trong cùng transaction (F-OA0-06) |
| `PATCH /admin/users/:id/employment-status` | `USER.MANAGE` | INACTIVE thì tắt tài khoản và revoke toàn bộ |
| `POST /admin/users/:id/account` | `USER.MANAGE` | Tạo tài khoản, mật khẩu khởi tạo, `must_change_password` |
| `PATCH /admin/users/:id/account-status` | `USER.MANAGE` | Tắt thì revoke toàn bộ |
| `POST /admin/users/:id/unlock` | `USER.MANAGE` | BA-USR-11 |
| `POST /admin/users/:id/reset-password` | `USER.MANAGE` | Revoke toàn bộ; `must_change_password` |
| `GET /admin/users/:id/effective-access` | `USER.VIEW` | Hợp permission và scope theo Role, kèm cảnh báo |
| `GET /admin/org-units/tree`, `GET/POST/PUT /admin/org-units/:id`, `PATCH …/status`, `GET …/members` | `ORGANIZATION.VIEW` / `MANAGE` | |
| `POST /admin/memberships`, `PUT /admin/memberships/:id`, `POST …/:id/end` | `ORGANIZATION.MANAGE` | Cùng service với lưu User (BA-UI-09) |
| `GET/POST/PUT /admin/job-titles`, `PATCH …/status` | `ORGANIZATION.VIEW` / `MANAGE` | |
| `GET /admin/workflow-groups`, `GET/PUT /admin/workflow-groups/:id` | `configure_permission` của nhóm | GET trả thành viên, ứng viên, lý do loại |
| `GET /…/:id/history` | quyền VIEW của target | Common Activity History |

[HT] Các picker ứng viên được chuyển bên dưới sang nhóm ứng viên. `PUT /pr-workflow/routes/:route` bị gỡ khi chức năng thay thế hoàn chỉnh tại OA4 (BA-N-12).

**Permission mới** (đều `admin_only`, không scope):

- `USER.VIEW`, `USER.MANAGE`
- `ROLE.VIEW`, `ROLE.MANAGE`
- `ORGANIZATION.VIEW`, `ORGANIZATION.MANAGE`
- `SALES_CONTRACT.CONFIGURE`

## 7. Permission–Scope Matrix [ĐX]

Nguyên tắc: không có quyền đọc ngầm. Cột **Hỗ trợ** là `supported_scopes`. Cột **Cấu hình khởi tạo** là grant đề xuất cho Role sau OA3. BA duyệt ma trận khởi tạo trước khi áp dụng OA3 (BA-N-13).

Ký hiệu scope: A = ALL, C = CREATOR, R = RESPONSIBLE, G = ASSIGNED, O = ORG_UNIT, T = ORG_UNIT_TREE, W = WAREHOUSE.

| Module · Permission | Hành động | Hỗ trợ | Cấu hình khởi tạo đề xuất |
|---|---|---|---|
| Master Data · `*.VIEW/CREATE/UPDATE`, `UOM.MANAGE`, `PROCUREMENT_CATALOG.MANAGE`, `DOSSIER_TYPE.VIEW` | Danh mục | – | Như baseline |
| Quản trị · `USER.*`, `ROLE.*`, `ORGANIZATION.*`, `*.CONFIGURE`, `DOSSIER_TYPE.MANAGE`, `DOSSIER_CONFIG.MANAGE` | Quản trị | – (`admin_only`) | Chỉ ADMIN |
| HĐ · `SALES_CONTRACT.VIEW` | List, Detail, Notes, History, File, picker HĐ nguồn | A C R O T | Không còn trong COMMON. Sales: C R; PM: R; Mua hàng và quản lý: theo BA (BA-RBAC-13) |
| HĐ · `SALES_CONTRACT.CREATE` | Tạo; Sửa, Chốt, Hủy HĐ Draft (Business Rule HĐ: người tạo hoặc Sales phụ trách, F-OA0-07) | A C R O T | Sales: C R. Sửa H-01 |
| HĐ · `PROPOSE/CONFIRM_PRODUCT` | Legacy | – | Gỡ ở phase HĐ |
| PR · `PR.VIEW` | List, Detail, Notes, History, File | A C R G O T | Mua hàng: A. Sales, PM: C R G. SALES_HEAD, PM_HEAD: G (+ O/T nếu BA muốn) |
| PR · `PR.CREATE` | Tạo; thao tác PR của mình | C R O T | Sales, PM: C R |
| PR · `PR.APPROVE`, `PR.RECEIVE` | Xử lý bước được giao | G O T A | Theo Role hiện có: G |
| PR · `PR.REASSIGN` | Phân công lại (quản lý nghiệp vụ, không `admin_only`) | A C R G O T | ADMIN; Role nghiệp vụ theo BA-N-13 |
| PR · `PR.DOSSIER_MANAGE` | Hồ sơ PR | A C R G O T | ADMIN |
| PO · `PO.VIEW/CREATE/APPROVE` | | A (P1) | Như baseline; scope C/G làm ở phase PO |
| Kho · `GRR/GR/GIR/GI.*`, `GIR.COMPLETE`, `GIR.SALES_CONFIRM`, `GR.DECLARE_DETAILS` | | W (P1) | Như baseline. Đọc ngầm qua người tạo hoặc người được giao **bị bỏ ở phase kho**, không bỏ ở OA |
| Tồn kho · `INVENTORY.VIEW` | | W | Như baseline |
| `SN_HISTORY.VIEW` | | – | Phase kho (BA-SCOPE-05) |

**Ngoại lệ đọc hiện tại và cách xử lý:**

| Ngoại lệ [HT] | Xử lý |
|---|---|
| ADR-0014: Sales phụ trách đọc PR qua `SALES_CONTRACT.VIEW` | Bỏ. Cần `PR.VIEW` scope R |
| PR: có `PR.CREATE`/`APPROVE`/`RECEIVE` thì đọc PR tạo, được giao, phụ trách | Bỏ. Cần `PR.VIEW` C/G/R |
| PR: Notes, History, File theo quyền đọc PR | Giữ; chuyển sang `assertCanRead` chung |
| Kho: người tạo, người được giao đọc chứng từ ngoài kho; `GR.DECLARE_DETAILS` | Giữ tạm đến phase kho. Ghi nhận là lệch với BA-AUTH-03 đã biết, có kế hoạch xử lý (§11) |
| Tab PR trên HĐ (H-13) | Hiển thị khi có `PR.VIEW` với bất kỳ scope nào; API lọc theo scope |
| Picker HĐ nguồn khi tạo PR | Cần `SALES_CONTRACT.VIEW` scope khớp **và** invariant người phụ trách |

### 7.1 Ma trận grant khởi tạo BA duyệt (OA3.0, BA-OA3-03)

Nguồn duy nhất trong code: `apps/api/src/database/oa3-grant-mapping.ts` (`OA3_GRANTS`), dùng cho seed demo và kế hoạch mapping. ADMIN do migration/trigger cấp theo BA-OA3-02. Permission không phân scope giữ như baseline.

| Permission | ADMIN | SALES | PM | PURCHASING | SALES_HEAD | PM_HEAD | WAREHOUSE_MANAGER |
|---|---|---|---|---|---|---|---|
| `SALES_CONTRACT.VIEW` | A | C R | R | – | – | – | – |
| `SALES_CONTRACT.CREATE` | A | C R | – | – | – | – | – |
| `PR.VIEW` | A | C R G | C R G | A | G | G | – |
| `PR.CREATE` | C R O T | C R | C R | – | – | – | – |
| `PR.APPROVE` | A | – | – | – | G | G | – |
| `PR.RECEIVE` | A | – | – | G | – | – | – |
| `PR.REASSIGN`, `PR.DOSSIER_MANAGE` | A | – | – | – | – | – | – |

**Hoãn đến OA3.3 (`OA3_DEFERRED`):** `PR.VIEW` của SALES, PM, SALES_HEAD, PM_HEAD. Các grant này thay cho đọc ngầm hiện tại. Trước khi scope engine lọc PR (OA3.3), `PR.VIEW` vẫn là toàn cục, nên cấp sớm sẽ cho các Role này đọc **mọi** PR (đã tái hiện bằng test `pr-scope`/`procurement`). Seed bỏ qua chúng ở OA3.1; phần ma trận còn lại chỉ thu hẹp quyền.

## 8. Dữ liệu legacy và snapshot quyền (BA-LEG)

### 8.1 Phân loại dữ liệu

| Loại | Xử lý |
|---|---|
| Master Data (hàng, hãng, NCC, khách hàng, kho, ĐVT, tiền tệ, thuế, dossier type) | Giữ |
| User cần giữ | Giữ. Admin khai báo `employee_code` trước OA2 (BA-USR-10) |
| User demo | Xóa và tạo lại bằng seed demo, kèm mã nhân viên |
| Role, `role_permissions`, `user_warehouses` còn phù hợp | Giữ; cấu hình lại HĐ, PR theo §7 sau khi BA duyệt danh sách |
| Pool PR, Sales/PM phụ trách của chứng từ giữ lại | Chuyển sang nhóm ứng viên (BA-WF-09) |
| Chứng từ thử nghiệm HĐ, PR, PO, GRR, GR, GIR, GI, tồn, lô, notes, activity, dossier, notification | **Đề xuất dọn** khi cần, theo §8.2. Không xóa toàn DB (BA-LEG-07) |

### 8.2 Quy trình dọn Dev (BA-LEG-06)

1. `pg_dump` Dev và kho file dossier. Ghi đường dẫn backup.
2. Script **dry-run** liệt kê số dòng theo bảng sẽ xóa, theo thứ tự phụ thuộc.
   - Activity History có trigger append-only [HT]. Dọn bằng script bảo trì Dev/Test có kiểm soát (tắt trigger trong transaction dọn); không có API xóa lịch sử (BA-N-14).
3. Gửi báo cáo phạm vi, chờ duyệt.
4. Chạy trong một transaction trên Dev. Chạy lại dry-run để xác nhận còn 0.
5. Test DB dùng fixture phá hủy đã xác minh [HT AGENTS.md]. Prod không áp dụng.

### 8.3 Snapshot quyền (BA-LEG-08)

1. **Trước:** với dữ liệu giữ lại, xuất ba bảng:
   - (a) `role → permission`;
   - (b) `user → permission`;
   - (c) ứng viên từng nhóm.
2. **Sau:** xuất cùng ba bảng kèm scope.
3. Script so sánh xếp mỗi khác biệt vào một trong hai loại:
   - **Đã duyệt:** gỡ `SALES_CONTRACT.VIEW` khỏi COMMON, bỏ đọc ngầm PR, grant mới theo §7 (BA-N-13), permission mới cấp cho ADMIN.
   - **Ngoài dự kiến:** mọi khác biệt còn lại. Có bất kỳ dòng nào loại này thì chặn áp dụng.
4. Danh sách "đã duyệt" là file versioned trong repo, được BA ký duyệt.
5. Phép so dữ liệu chứng từ không còn cần, vì chứng từ thử nghiệm được dọn hoặc đánh giá lại theo quy tắc mới. Hành vi đọc được kiểm bằng test ma trận (§12).

### 8.4 Seed (BA-SEC-06)

- Catalog permission, metadata, Role ADMIN và nhóm ứng viên do migration tạo.
- Seed demo chỉ chạy trên DB không có user ngoài tài khoản hệ thống. User demo có mã nhân viên, mật khẩu ≥ 12 ký tự và luôn `must_change_password` (BA-N-15). Fixture automated test tự chuẩn bị user ở trạng thái cần thiết; runtime không có ngoại lệ.
- Bỏ `DELETE PR.CREATE` [HT `seed.ts:76`]. Seed không chạm grant của DB đã cấu hình.

## 9. Thiết kế UI chi tiết [BA + ĐX]

Chung cho mọi màn:

- Dùng Common UI (BA-UI-08), `ActionButton` theo COMMON-BUTTON-001, `ActionResultDialog`.
- Mã lỗi cần hiển thị: `LAST_ADMIN`, `VERSION_CONFLICT`, `PASSWORD_CHANGE_REQUIRED`, `SELF_CHANGE_DENIED`, `ACCOUNT_LOCKED`.
- Mọi màn có Dirty Guard và UI-EVIDENCE-001.
- Menu Hệ thống chỉ hiện với ADMIN, vì mọi permission quản trị đều `admin_only`.

| Màn hình | Phase | Bố cục | Chi tiết |
|---|---|---|---|
| **Đăng nhập** | OA1 | Hiện có | Thông báo thất bại thống nhất, không lộ khóa (BA-N-10); đổi mật khẩu thành công quay về đây |
| **Bắt buộc đổi mật khẩu** | OA1 | Trang riêng ngoài AppShell (BA-UI-07, BA-UI-12) | Mật khẩu hiện tại, mới, xác nhận; rule ≥ 12 ký tự dùng chung FE/BE; nút Đăng xuất; mọi route khác chuyển về đây khi API trả `PASSWORD_CHANGE_REQUIRED`; thành công thì xóa token và về Đăng nhập (F-OA0-01) |
| **Hồ sơ cá nhân** | OA1 (đổi mật khẩu), OA2 (email, phone) | Từ menu tài khoản AppShell | Xem thông tin, tổ chức, vai trò (chỉ đọc); sửa Email, SĐT; đổi mật khẩu bằng FormDialog |
| **Vai trò & Phân quyền · List** | OA1 | `ListPageLayout` + `DataTable` | Cột Mã, Tên, Mô tả, Hệ thống, Trạng thái, Số Permission, Số người dùng; filter từ khóa, trạng thái; thao tác dòng Edit, Copy |
| **Vai trò · View/Edit** | OA1 (Thông tin chung, Phân quyền, Người dùng chỉ đọc, Lịch sử), OA3 (cột Scope) | `DetailPageLayout` Full Page | Tab Phân quyền: nhóm theo module (accordion); mỗi dòng có checkbox permission, ô chọn scope (chỉ các scope hỗ trợ), badge "Quản trị"; không có "Chọn tất cả" toàn hệ thống (BA-UI-05); cảnh báo inline cho permission có scope nhưng chưa chọn scope, và thiếu VIEW khi có quyền thao tác (BA-AUTH-11). Hỗ trợ **nhiều scope** trên cùng permission (multi-select). Role ADMIN: sửa được tên và mô tả; mã, trạng thái, cờ hệ thống và grant được bảo vệ. Copy Role mở Create đã điền permission + scope, không copy User hay Candidate Pool |
| **Người dùng · List** | OA2 | `ListPageLayout` | Cột Mã NV, Họ tên, Username, Email, SĐT, Đơn vị chính, Chức danh chính, Nhân sự, Tài khoản (Hoạt động/Tắt/Khóa tạm/Không có); filter từ khóa, đơn vị, Role, trạng thái nhân sự, trạng thái tài khoản; thao tác dòng Edit |
| **Người dùng · Create/View/Edit** | OA2 (Thông tin chung, Tổ chức, Vai trò, Phạm vi dữ liệu với Warehouse Grant, Lịch sử), OA3 (effective-access theo scope) | Full Page, lưu tập trung một nút Lưu (BA-UI-04) | **Thông tin chung:** mã NV, họ tên, email, SĐT, trạng thái nhân sự. **Tổ chức:** bảng membership (đơn vị, chức danh, quản lý trực tiếp, chính); dòng đã kết thúc hiện mờ. **Vai trò:** Role picker. **Phạm vi dữ liệu:** Warehouse Grant (Kho picker, lưu cùng nút Lưu) và effective-access chỉ đọc theo module kèm cảnh báo. **Lịch sử:** Activity. **Create:** tùy chọn "Tạo tài khoản" (username, mật khẩu khởi tạo) lưu cùng transaction nhân sự. Khối "Tài khoản" ở View/Edit tách riêng với các nút Tạo tài khoản, Bật/Tắt, Mở khóa (kèm trạng thái khóa), Reset mật khẩu; mỗi nút xác nhận riêng |
| **Cơ cấu tổ chức** | OA2 | Tree trái + Detail Panel phải (BA-UI-02) | Cây bằng MUI List lồng nhau; tìm theo mã hoặc tên và giữ nhánh cha của kết quả; mở/đóng từng nút và mở/đóng toàn bộ; mỗi nút hiện số nhân sự và số đơn vị con; không drag-drop; đổi cấp cha qua field "Đơn vị cha" trong form. Tab Thông tin chung (mã, tên, cha, người đứng đầu chỉ chọn từ thành viên, trạng thái); tab Nhân sự (membership ACTIVE, thêm/kết thúc dùng chung API với màn User); tab Lịch sử |
| **Chức danh** | OA2 | `CatalogPage` + `FormDialog` (BA-UI-03) | Mã, tên, mô tả, trạng thái; ngừng bị chặn kèm lý do |
| **Cấu hình quy trình** | OA4 | Hai panel (BA-UI-06) | Trái: danh sách loại chứng từ (HĐ, PR). Phải: sơ đồ quy trình của loại chứng từ (các bước, dựng bằng component hiện có) và các nhóm ứng viên gắn với bước; mỗi nhóm có thành viên Role/User (picker), ứng viên thực tế, bảng "không đủ điều kiện" kèm mã lý do; lưu theo version |
| **HĐ, PR · đơn vị chịu trách nhiệm** | OA3 (F-OA0-05) | Field trên form Create | Mặc định đơn vị chính; dropdown các đơn vị đang tham gia; để trống khi không có membership (BA-N-08); View chỉ đọc |

Dependency: không thêm `@mui/x-tree-view` (BA-UI-10). [HT] chỉ có `@mui/material`, `@mui/icons-material`, `@mui/x-data-grid`.

## 10. Rủi ro

| # | Rủi ro | Biện pháp |
|---|---|---|
| R-01 | Sót nơi JOIN grant khi thêm `roles.is_active` | `v_user_grants`/`lockGrant` + test kiến trúc cấm JOIN `role_permissions` ngoài Authorization |
| R-02 | Thay đổi quyền ngoài dự kiến | Snapshot phân loại §8.3 chặn áp dụng |
| R-03 | Bỏ đọc ngầm làm Sales, PM, người duyệt mất truy cập PR đang xử lý | Grant khởi tạo §7 cho đủ C/R/G trước khi bật kiểm tra; test ma trận từng Role |
| R-04 | Admin tự khóa hệ thống | §5.5 trên mọi đường, test đồng thời |
| R-05 | Nâng quyền gián tiếp | §5.4, một test cho mỗi đường |
| R-06 | Token cũ sống lại | `user_sessions`; test kích hoạt lại tài khoản |
| R-07 | Brute-force | Lockout. Rate-limit theo IP là P2 |
| R-08 | Lộ hash | Danh sách trường được phép; test quét response và audit |
| R-09 | Vòng lặp cây hoặc chuỗi quản lý do race | Advisory lock riêng |
| R-10 | Scope ORG chậm | Tính tập đơn vị một lần mỗi request |
| R-11 | List, Detail, File lệch nhau | `assertCanRead` dùng chung, test ma trận endpoint × user |
| R-12 | Kho còn đọc ngầm đến phase kho | Ghi nhận lệch có kế hoạch; không mở rộng thêm |
| R-13 | Dọn dữ liệu xóa nhầm Master Data | Dry-run, backup, duyệt §8.2 |
| R-14 | Activity append-only chặn dọn chứng từ thử nghiệm | Script bảo trì Dev/Test có kiểm soát (BA-N-14) |
| R-15 | PO, kho kẹt khi người duyệt mất quyền | Đã biết (H-07), xử lý ở phase PO, kho |

## 11. Roadmap và kế hoạch (BA-SCOPE-04, BA-UI-11)

Các phase triển khai tuần tự. Mỗi phase có UI tương ứng và UI-EVIDENCE.

| Phase | P | Backend | UI cùng phase | Phụ thuộc |
|---|---|---|---|---|
| **OA0** Architecture & Specification | – | Tài liệu này, ADR-0018 | – | – |
| **OA1** Authorization & Account Security | P1 | Metadata permission (`module`, `name`, `supported_scopes`, `admin_only`); `roles.is_active/is_system`; `v_user_grants`, `AuthorizationService` (`load`, `has`, `lockGrant`) và chuyển 5 call site; `user_sessions`, logout, revoke toàn bộ; mật khẩu ≥ 12, đổi mật khẩu, `must_change_password`; lockout 5/15, unlock; Admin guard; chặn tự thay đổi; API Role; key `ROLE.*`; Activity USER/ROLE; seed an toàn | Bắt buộc đổi mật khẩu; đổi mật khẩu trong Hồ sơ cá nhân; Vai trò List/View/Edit (chưa có scope) | OA0 |
| **OA2** Organization & User Management (OA2.1 Job Title → OA2.2 Organization → OA2.3 User Management → OA2.4 Personal Profile & Integration) | P1 | Hồ sơ nhân sự trên `users` (`employee_code` có preflight); `org_units`, `job_titles`, `org_memberships` và các quy tắc §4.3; API User lưu tập trung, account, reset, unlock; `/me`; key `USER.*`, `ORGANIZATION.*` | Người dùng List/Full Page (trừ tab Phạm vi); Cơ cấu tổ chức; Chức danh; Hồ sơ cá nhân email/SĐT | OA1 |
| **OA3** Data Scope | P1 | `role_permission_scopes` + trigger; `scopeFilter`, `assertCanRead`, `canAccessDraft`; `owner_org_unit_id` HĐ, PR kèm chọn đơn vị khi tạo (F-OA0-05); bỏ đọc ngầm PR (ADR-0014, ADR-0015); scope cho HĐ; grant khởi tạo §7 (sau khi BA duyệt, BA-N-13); snapshot §8.3; effective-access | Cột Scope (nhiều scope) ở tab Phân quyền, chặn lưu khi thiếu; effective-access ở tab Phạm vi dữ liệu; field đơn vị chịu trách nhiệm trên Create HĐ/PR | OA2 |
| **OA4** Workflow Eligibility | P1 | `workflow_candidate_*`; chuyển pool PR và ứng viên Sales/PM phụ trách; `candidates()` hai mức, đánh giá trạng thái dự kiến, kèm lý do; `SALES_CONTRACT.CONFIGURE`; gỡ `PUT /pr-workflow/routes/:route` | Cấu hình quy trình | OA3 (cần scope cho eligibility trên chứng từ) |
| **OA5** Administration UX Completion | P2 | – | Phần UX còn lại sau khi các màn đã duyệt hoàn thành ở OA1–OA4: polish, rà soát nhất quán, UI-EVIDENCE tổng | OA4 |
| **OA6** Business Integration | P1 | Notes, History, File HĐ/PR dùng `assertCanRead`; đổi nhãn `department`; gỡ `pr_candidate_pool_members` | Tab PR trên HĐ theo scope | OA4 |
| **OA7** Technical Review & UAT | – | Security review, dọn Dev theo §8.2 (nếu được duyệt), snapshot, UAT | UAT trên trình duyệt | OA6 |

- **OA2 chia đợt (BA xác nhận sau OA1.3; OA1 hoàn thành, không có OA1.4):**
  - **OA2.1 Job Title:** danh mục `job_titles`, key `ORGANIZATION.*`, màn Chức danh.
  - **OA2.2 Organization:** `org_units`, cây đơn vị, head, màn Cơ cấu tổ chức.
  - **OA2.3 User Management:** hồ sơ nhân sự trên `users`, `org_memberships`, API User lưu tập trung, `EMPLOYMENT_INACTIVE`, username không phân biệt hoa thường, lịch sử User khi đổi Role; kiểm tra chức danh đang dùng khi ngừng (§4.3).
    - **Chia đợt OA2.3 (BA giao tại OA2.3a):** **OA2.3a** hồ sơ nhân sự, tài khoản tùy chọn, vòng đời nhân sự/tài khoản (backend). **OA2.3b** membership, Role, Warehouse, trưởng đơn vị, lưu tập trung atomic và concurrency. **OA2.3c** frontend và tích hợp Organization.
  - **OA2.4 Personal Profile & Integration:** `/me`, hồ sơ cá nhân sửa email/SĐT, tích hợp và nghiệm thu OA2.
- **P2** (sau P1): UX OA5; rate-limit theo IP; báo cáo "ai có quyền X"; sửa H-11.
- **P2 thuộc phase nghiệp vụ** (không thuộc OA): scope và đơn vị cho PO và kho; bỏ đọc ngầm kho; Reassign cho PO và kho.
- **P3:** MFA, SSO, refresh token, ủy quyền tạm thời, lập lịch điều chuyển, field-level permission, workflow động, HRM, Delegated Administration.

### 11.0 Trạng thái triển khai

| Phần | Trạng thái |
|---|---|
| OA0 | Hoàn thành (`788135b`) |
| **OA1.1** Authorization Foundation | **Hoàn thành.** Catalog có metadata và `admin_only` (migration `1733443200000`); `roles.is_active/is_system`; ADMIN bảo vệ bằng trigger DB (INSERT/UPDATE/DELETE/TRUNCATE trên `roles`, `role_permissions`, cờ `admin_only`); key mới tự cấp cho ADMIN; `v_user_grants`; module `identity/authorization.ts` (`loadGrants`, `grantRole` có `lock`, `usersWithPermission`) thay 5 điểm truy vấn grant; seed chỉ tạo khi thiếu |
| **OA1.2** Account Security | **Hoàn thành.** Migration `1733529600000`: `user_sessions`, cột mật khẩu/khóa trên `users`, target Activity `USER`. JWT `{sub, sid, exp}`, session kiểm tra trong cùng query nạp quyền; logout thu hồi phiên hiện tại; đổi/reset mật khẩu, vô hiệu hóa thu hồi toàn bộ. Khóa 5 lần/15 phút, ADMIN mở khóa. `must_change_password` chỉ cho `/auth/me`, `/auth/change-password`, `/auth/logout`. API: `POST /auth/logout`, `POST /auth/change-password`, `GET /admin/users/:id/account`, `POST /admin/users/:id/reset-password`, `PATCH /admin/users/:id/account-status`, `POST /admin/users/:id/unlock`. Last Admin Protection (`lockAdminGuard` + `assertAdminRemains`) áp cho vô hiệu hóa tài khoản và dùng lại ở OA1.3 |
| **OA1.3** Role & Permission Management | **Hoàn thành.** Migration `1733616000000`: `permissions.sort_order`, `roles.updated_by`, target Activity `ROLE`; grant hiện có không đổi. API `/admin/permissions`, `/admin/roles` (list server-side, detail, create/copy, update, status, history, user-options). UI Hệ thống → Vai trò & Phân quyền: List, Full Page 4 tab, Accordion quyền, User Picker, Lịch sử |
| **OA2.1** Job Title | **Hoàn thành, BA đã nghiệm thu.** Migration `1733702400000`: bảng `job_titles` (`code` unique không phân biệt hoa thường, `status` ACTIVE/INACTIVE, `version`, audit cols), key `ORGANIZATION.VIEW/MANAGE` (`admin_only`, chỉ ADMIN qua trigger OA1.1), target Activity `JOB_TITLE`. API `/admin/job-titles` (list server-side, detail, create/copy, update, status, history). UI Hệ thống → Chức danh |
| **OA2.2** Organization | **Hoàn thành, BA đã nghiệm thu (gồm Closure Patch F01–F08).** Migration `1733788800000`: bảng `org_units` (§4.3; `head_user_id` có cột nhưng luôn NULL đến OA2.3), target Activity `ORG_UNIT`. API `/admin/org-units` (tree, detail, create, update/chuyển cha, status, history). UI Hệ thống → Cơ cấu tổ chức |
| **OA2.3a** User, Employee & Account (backend) | **Hoàn thành, BA đã nghiệm thu (gồm Closure Review F01–F04).** Migration `1733875200000` (§11.0 "Chi tiết OA2.3"). API `/admin/users` (list server-side, detail, create có/không tài khoản, update hồ sơ, employment-status, cấp tài khoản, history). Không có UI ở đợt này |
| **OA2.3b** Membership, Role, Warehouse & Atomic Save (backend) | **Hoàn thành, BA/Architect đã nghiệm thu (acceptance (1)–(13), Closure Patch F01–F05, concurrency chuyển đơn vị chính).** Migration `1733961600000` (`org_memberships`). Lưu User tập trung (hồ sơ, membership, Role, Warehouse) một transaction; head đơn vị; `GET …/members`, số nhân sự trên cây, lọc User theo đơn vị; F01 version cho tài khoản (§11.0 "Chi tiết OA2.3"). Không có UI |
| **OA2.3c** User Management UI & Organization Integration | **Hoàn thành, BA đã duyệt Closure Patch F01–F12.** Backend chỉ bổ sung `membershipId`/`membershipVersion` vào `GET …/members` (F11, BA duyệt). UI Hệ thống → Người dùng (List + Full Page 5 tab, lưu tập trung atomic, khối Tài khoản, trạng thái nhân sự); Cơ cấu tổ chức: số nhân sự trên cây, tab Nhân sự qua Membership API, chọn trưởng đơn vị. Chi tiết ở §11.0 "OA2.3c" |
| **OA2.4** Personal Profile & Integration | **Hoàn thành, BA đã nghiệm thu (gồm Closure Patch F01–F05). OA2 hoàn thành, BA đã nghiệm thu toàn bộ.** Không migration. API `GET /me`, `PATCH /me` (chỉ email/SĐT + version). Hồ sơ cá nhân từ menu tài khoản. Chi tiết §11.0 "OA2.4" |
| **OA3.0** Data Scope Review | **BA đã duyệt** (§2.14, §7.1) |
| **OA3.1** Schema & Role API | **Hoàn thành, BA đã nghiệm thu (gồm F01–F04).** Migration `1734048000000` (§11.0 "Chi tiết OA3.1"). Scope engine chưa áp lên nghiệp vụ; chưa có UI chọn scope |
| **OA3.2** Scope Engine & Locking | **Hoàn thành, BA đã nghiệm thu (gồm F01–F03).** Không migration. Engine `identity/data-scope.ts`; gate `grants` exclusive cho đổi membership và mọi ghi đơn vị (§11.0 "Chi tiết OA3.2"). Chưa áp lên HĐ/PR, chưa có UI |

**Chi tiết OA3.1:**

- **Schema.** `permissions.supported_scopes text[]` (CHECK: chỉ 7 loại, không NULL, `admin_only` ⇒ `'{}'`); giá trị theo §7, PO/kho/Master Data/quản trị là `'{}'` (BA-OA3-09). Bảng `role_permission_scopes (role_id, permission_id, scope_type)` PK 3 cột, FK `(role_id, permission_id) → role_permissions ON DELETE CASCADE`. `sales_contracts.owner_org_unit_id`, `purchase_requisitions.owner_org_unit_id` `int NULL → org_units`, có index, không backfill (BA-SCP-12).
- **Trigger.** `guard_role_permission_scope`: scope phải nằm trong `supported_scopes`; dòng scope của Role hệ thống không ghi trực tiếp được, chỉ trigger catalog ghi (`pg_trigger_depth() ≥ 2`). `guard_supported_scopes`: thu hẹp `supported_scopes` bị chặn khi Role **nghiệp vụ** còn dòng scope ngoài tập mới (migration cấu hình lại Role đó trước). Cấm TRUNCATE. `grant_new_permission_to_system_roles` cấp scope cho ADMIN khi thêm key mới.
- **ADMIN invariant (F02, BA-OA3-02).** Trigger `sync_system_role_scopes` (AFTER UPDATE OF `supported_scopes`) đồng bộ ADMIN trong cùng câu lệnh, tức cùng transaction của migration: ALL nếu hỗ trợ, nếu không thì toàn bộ supported scopes. Bao gồm unscoped → scoped, scoped → unscoped, nới, thu hẹp, thêm hoặc bỏ ALL. Migration catalog không cần viết SQL riêng cho ADMIN; không còn technical debt.
- **Grant thiếu scope (F01).** Invariant theo tầng:
  - **DB:** chỉ đảm bảo scope hợp lệ (thuộc `supported_scopes`, có grant cha, ADMIN cố định). DB **cho phép** grant có scope mà không có dòng scope: grant thêm bằng SQL tay, xóa scope cuối cùng, hoặc permission chuyển từ unscoped sang scoped. Không thêm trigger kiểm "≥ 1 scope", vì trường hợp chuyển catalog cần migration cấu hình lại Role sau đó, và §4.1 đã chọn fail-closed ở runtime.
  - **API:** lưu Role luôn chặn bằng `SCOPE_REQUIRED` (BA-N-03).
  - **Engine OA3.2 (bắt buộc):** grant như vậy coi như không có scope cho permission đó, nên bị từ chối. Không mặc định ALL. Grant hợp lệ của Role khác trên cùng permission vẫn có hiệu lực (BA-OA3-05). Effective-access (OA3.4) và kế hoạch mapping (`unmapped`/`rescope`) hiển thị các grant này để Admin xử lý.
- **ADMIN.** ALL cho permission hỗ trợ ALL; `PR.CREATE` nhận C/R/O/T. Qua API: đổi scope của ADMIN → `SYSTEM_ROLE_PROTECTED`.
- **Role API.** `GET /admin/permissions` thêm `supportedScopes`. `GET /admin/roles/:id` thêm `scopes: {permission: scope[]}` (sắp xếp, chỉ permission có scope). `POST`/`PUT` nhận thêm `scopes` cùng `permissions` (mở rộng contract OA1.3, không đổi sang `grants[]`). Validation: `SCOPE_REQUIRED` (permission có scope mà chưa chọn, BA-N-03), `SCOPE_NOT_SUPPORTED` (ngoài danh sách hỗ trợ, sai kiểu, hoặc scope cho permission không phân scope), `SCOPE_WITHOUT_PERMISSION` (scope cho permission không được chọn). Trùng lặp được gộp. Không mặc định ALL.
- **Transaction, lock, version.** Giữ nguyên lock graph OA1.3: đổi scope thuộc lưu Role nên đã lấy gate `grants` exclusive trước mọi dòng; `version` tăng một lần; mọi lỗi rollback toàn bộ (gồm scope).
- **Audit.** `ROLE_CREATED`/`ROLE_COPIED` ghi `scopes`; `PERMISSIONS_ADDED` ghi `scopes` của quyền mới; `PERMISSIONS_REMOVED` ghi `scopes` của quyền bị thu hồi, đọc trước khi xóa nên FK cascade không làm mất (F03); `SCOPES_UPDATED` ghi `{before, after}` theo permission bị đổi scope. Lưu cùng scope theo thứ tự khác không ghi sự kiện.
- **Copy.** Create điền sẵn permission + scope; Web chuyển nguyên scope của Role nguồn.
- **Seed.** Gỡ `SALES_CONTRACT.VIEW` khỏi COMMON; Role mới tạo nhận grant và scope theo §7.1 trừ `OA3_DEFERRED`; Role đã có không bị ghi đè (BA-SEC-06).
- **Mapping có kiểm soát.** `planGrantMapping(m)` chỉ đọc, trả `add`, `remove`, `rescope`, `unmapped` (Role tùy chỉnh giữ nguyên, fail-closed đến khi Admin cấu hình). Chế độ áp dụng, snapshot trước/sau §8.3 và rehearsal thuộc OA3.5.
- **4 grant hoãn (F04).** Tại OA3.3, cùng commit bật lọc scope cho PR:
  - xóa `OA3_DEFERRED` và `activeGrants`, seed dùng thẳng `OA3_GRANTS`;
  - seed vẫn **chỉ tạo Role còn thiếu**, không ghi đè Role hiện hữu (BA-SEC-06).
  - **Test DB:** `bootTestApp` tạo lại schema, migration và seed mỗi lần chạy, nên tự có ma trận đầy đủ. Không cần thao tác thêm.
  - **DB đã seed có dữ liệu giữ lại (Dev, demo):** chỉ áp dụng qua mapping OA3.5: dry-run `planGrantMapping` (4 dòng `add`), snapshot trước/sau, Admin duyệt rồi apply trong một transaction (gate `grants` exclusive). Cấu hình qua màn Vai trò là phương án dự phòng.
  - Branch chỉ merge khi xong OA3, nên Dev không bao giờ ở trạng thái đã gỡ đọc ngầm mà chưa có 4 grant (R-03).

**Carryover sau OA3.1:**

| Phase | Việc |
|---|---|
| OA3.2 | **Xong, BA đã nghiệm thu ("Chi tiết OA3.2").** Engine fail-closed với grant thiếu scope (F01); hợp scope từ nhiều Role, grant thiếu scope không làm mất grant hợp lệ của Role khác; gate `grants` exclusive cho đổi membership và chuyển đơn vị cha (F02 của OA3.0) |
| OA3.3 | Bật lọc HĐ/PR; xóa `OA3_DEFERRED`/`activeGrants`; gỡ đọc ngầm ADR-0014/0015; chặn bypass F08/F09/F11/F12 (BA-OA3-09); `owner_org_unit_id` khi tạo; H-01 |
| OA3.4 | UI cột Scope (multi-select, chặn lưu, cảnh báo); effective-access liệt kê grant thiếu scope; kho được cấp trên Hồ sơ cá nhân; field đơn vị chịu trách nhiệm |
| OA3.5 | Chế độ apply + CLI dry-run cho mapping, snapshot §8.3, rehearsal nâng cấp từ `a476e0c`; kế hoạch áp dụng Dev chờ duyệt |
- **Web (tối thiểu, không phải UI OA3.4).** Màn Vai trò gửi lại scope đã tải khi lưu, để không làm mất scope hiện có. Chọn quyền mới có scope sẽ nhận `SCOPE_REQUIRED` cho đến OA3.4.
- **Test thay đổi có chủ đích.** Helper lưu Role trong các spec gửi kèm `scopes`. `TRUNCATE role_permissions` nay bị FK từ chối trước trigger. Test migration OA2.3b dừng ở OA2.3b. Test nâng cấp OA0 revert thêm OA3.1.

**Chi tiết OA3.2 (Scope Engine & Locking):**

- **File.** Engine: `apps/api/src/modules/identity/data-scope.ts`. Gate: `identity/user-admin.ts` (`create`, `update`, `editMemberships`), `organization/org-unit-admin.ts` (`lockTree`). Test: `apps/api/src/data-scope-engine.int.spec.ts` (15 test). `authorization.ts` (`loadGrants`, `grantRole`, gate) không đổi. Không migration.
- **Contract engine** (không rule nghiệp vụ, không cache; mọi hàm nhận `em` của transaction gọi):
  - `loadDataScope(m, userId, lock = false): DataScope`: **một câu SQL**, nên grants, scope, membership và cây cùng một snapshot. `lock = true` lấy gate `grants` shared trước (như `grantRole(lock)`), dùng trong transaction nghiệp vụ; gọi trước mọi row lock hoặc sau `lockActor` (đã giữ gate). Nạp mỗi request/transaction, không giữ qua request.
  - `DataScope = { userId, grants, orgUnitIds, orgTreeIds, warehouseIds }`.
    - `grants[permission]`: không có key = không có quyền; `null` = permission không phân scope (`supported_scopes = '{}'`), chỉ cần grant; mảng = **hợp** scope của mọi Role active cấp permission đó (BA-SCP-05). Grant thiếu dòng scope không đóng góp gì: chỉ có nó thì `[]` (có quyền, không thấy dữ liệu, F01); có thêm Role hợp lệ thì vẫn nhận scope của Role đó (BA-OA3-05). Không mặc định ALL. Nguồn grant: `v_user_grants` (account active, Role active).
    - `orgUnitIds`: đơn vị của mọi membership ACTIVE (BA-SCP-13). `orgTreeIds`: `orgUnitIds` cộng mọi đơn vị con cháu (đệ quy `parent_id`, không lọc trạng thái). Membership ENDED không tính.
  - `hasPermission(s, p)`: có grant, không xét scope.
  - `scopeFilter(s, permission, cols, first = 1) → { sql, params } | null`: `null` ⇒ từ chối; unscoped hoặc ALL ⇒ `TRUE`; còn lại OR các scope của **chính** permission đó, placeholder từ `$first`. `ScopeColumns = { creator?, responsible?: string[], assigned?, orgUnit?, warehouse? }` do module sở hữu khai báo; `assigned` là biểu thức SQL boolean dùng `:uid` (vd. `EXISTS` node workflow có assignee hiện tại hoặc đã từng, BA-OA3-04). Scope được cấp mà module không khai báo cột ⇒ **throw** (catalog/module lệch).
  - `matchesDraft(s, permission, draft)`: bản TypeScript của cùng bảng §5.3; `ScopeDraft = { creatorId?, responsibleIds?, assigneeIds?, orgUnitId?, warehouseId? }`; field thiếu/NULL không khớp. Owner NULL không khớp O/T ở cả SQL (`NULL = ANY(...)`) và TS.
  - `inScope(m, s, p, src, id)`; `assertCanRead(m, s, view, src, id)`: không có VIEW → 403; có VIEW nhưng ngoài scope, grant thiếu scope hoặc ID không tồn tại → 404 (BA-OA3-07). `assertCanAct(m, s, view, action, src, id)`: đọc được trước, rồi action + scope của action (403). `ScopeSource = { from, id, cols }`, `from` là biểu thức bảng tin cậy kèm alias, không nhận từ client.
  - `canAccessDraft(s, view, action, draft)` cho CREATE (F-OA0-03): action và view cùng khớp trạng thái dự kiến; module kiểm lại trong transaction lưu (`loadDataScope(m, uid, true)`).
  - ADMIN không bypass: chỉ là Role có dòng scope ALL/đủ supported scopes (BA-OA3-02); vd. `PR.CREATE` của ADMIN không khớp chứng từ người khác tạo có owner NULL.
- **Lock graph** (kế thừa OA1.3/OA2.2, không đổi thứ tự): admin-guard → `grants` → `users` (id tăng) → `roles` → `org-tree` → `org_units` → `job_titles` → `org_memberships` → dòng chứng từ. OA3.2 bổ sung: mọi đường làm đổi kết quả `loadDataScope` lấy `grants` **exclusive** trước mọi row lock. Không đường nào xin shared rồi exclusive; exclusive rồi shared (`lockActor`) không phải nâng cấp.

| Đường ghi | Trước OA3.2 | OA3.2 |
|---|---|---|
| Lưu Role (quyền, scope, thành viên), trạng thái Role | exclusive | giữ nguyên |
| Vô hiệu hóa/kích hoạt tài khoản, trạng thái nhân sự | exclusive | giữ nguyên |
| `PUT /admin/users/:id` | exclusive khi có `roleIds`/`warehouseIds` | thêm khi có `memberships` |
| `POST /admin/users` | exclusive khi có role/kho | thêm khi có `memberships` |
| Membership API (`POST /admin/memberships`, `PUT …/:id`, `POST …/:id/end`) | shared | **exclusive** (trước `lockActor`) |
| Mọi ghi đơn vị: tạo, `PUT /admin/org-units/:id` (cha, head, tên), đổi trạng thái | shared | **exclusive** trong `lockTree` (F01) |
| Chức danh | shared | giữ shared (không ảnh hưởng scope) |
| Cấp tài khoản | shared | giữ shared (chưa có Role nên không đổi grant) |
| Reset mật khẩu, mở khóa, `/me` | shared | giữ nguyên |

- **Đảm bảo snapshot.** Reader trong transaction nghiệp vụ giữ gate shared (`loadDataScope(m, uid, true)` hoặc sau `lockActor`) nên mọi writer bảng trên chờ reader commit; nạp lại trong cùng transaction cho cùng kết quả. READ COMMITTED: request sau commit của writer thấy dữ liệu mới. Đọc ngoài transaction (list) dùng một câu `loadDataScope` không lock, rồi `scopeFilter`.
- **Test PostgreSQL** (`data-scope-engine.int.spec.ts`): hợp scope nhiều Role, không trộn chéo permission; fail-closed từng grant (grant SQL tay không scope) và giữ grant hợp lệ của Role khác; unscoped `PO.VIEW`; ADMIN không bypass; Role inactive; nhiều membership, cây 4 cấp, nhánh khác, kết thúc membership qua API; parity SQL/TS trên bảng tạm (mọi scope đơn, hợp, rỗng, toàn bộ; creator/responsible/owner NULL; assignee); throw khi thiếu cột; 403/404 của `assertCanRead`/`assertCanAct`, `canAccessDraft`; 4 writer (Membership API, lưu User memberships, đổi cha, đổi scope Role) phải **chờ** reader giữ gate shared (kiểm `pg_locks` advisory chưa granted), reader không thấy thay đổi trong transaction của mình, load sau commit thấy; reader + 3 writer song song 3 vòng, không deadlock. Hồi quy liên quan pass: `user-membership`, `org-unit-admin`, `user-admin`, `data-scope`, `authorization`, `role-admin`, `personal-profile` (99 test). API build pass. Full regression để OA3.5.
- **Chưa làm (OA3.3+).** Chưa gọi engine ở HĐ/PR (List, Detail, Notes, History, File, action); `OA3_DEFERRED`/`activeGrants` còn nguyên; `CurrentUser`/`loadGrants` chưa mang scope (OA3.3 gọi `loadDataScope` ở service, không thêm vào AuthGuard để tránh query thừa mỗi request); chưa có test theo module "mỗi scope trong `supported_scopes` có cột khai báo"; ASSIGNED mới kiểm trên bảng tạm, biểu thức thật trên node workflow PR do OA3.3 khai báo. Mọi ghi đơn vị nay tuần tự với kiểm tra quyền đang chạy (thao tác quản trị hiếm, chấp nhận vì đúng đắn trước tối ưu).
- **Rà soát cuối OA3.2 (BA F01–F03):**
  - **F01 Org gate — có ảnh hưởng, đã sửa.** Tạo đơn vị con dưới đơn vị có thành viên làm `orgTreeIds` của thành viên đó thay đổi. Đổi trạng thái đơn vị không đổi kết quả hiện tại (ngừng đơn vị đòi không còn membership ACTIVE; `orgTreeIds` không lọc trạng thái) nhưng vẫn khóa theo nguyên tắc đúng trước tối ưu. Nay `OrgUnitAdminService.lockTree` lấy `grants` **exclusive** trước `lockActor` cho **mọi** ghi đơn vị (tạo, sửa/chuyển cha/head, đổi trạng thái). Test: tạo đơn vị con và đổi trạng thái đơn vị đều chờ reader giữ gate shared; load sau commit thấy đơn vị con trong `orgTreeIds`. Chức danh không ảnh hưởng scope, giữ shared.
  - **F02 Snapshot / transaction boundary — chốt cho OA3.3** (mục "Transaction boundary OA3.3" dưới đây).
  - **F03 Lock graph — đạt, không sửa code.** Đã đối chiếu từng đường: vô hiệu hóa/kích hoạt tài khoản (`setAccountStatus`: admin-guard → exclusive), trạng thái nhân sự (admin-guard → exclusive), tạo/sửa/trạng thái Role và thành viên Role (exclusive trước `lockActor`; Role hệ thống admin-guard trước), thêm/gỡ Role và kho từ màn User (`create`: exclusive khi có role/kho/membership; `update`: admin-guard khi có `roleIds`, exclusive khi có `roleIds`/`warehouseIds`/`memberships`), Membership API (exclusive). Chỉ shared: reset mật khẩu, mở khóa, `/me`, cấp tài khoản (`createAccount`: user chưa có Role vì Role đòi tài khoản, nên không đổi grant). Mọi đường xin exclusive trước `lockActor`; không đường nào xin shared rồi exclusive. Ghi `user_roles`/`user_warehouses` chỉ có trong `role-admin.update` và `user-admin.saveRelations`, đều dưới exclusive.

**Transaction boundary OA3.3 (F02, bắt buộc):**

1. **List + COUNT:** một `loadDataScope(m, uid)` cho request; items và total dùng **cùng** `scopeFilter` (cùng params). Nếu chạy hai câu, đặt trong một transaction `REPEATABLE READ READ ONLY` (hoặc một câu với `count(*) OVER ()`) để scope, items và total cùng snapshot. Không nạp scope lại giữa hai câu.
2. **Detail / Notes / History / File:** trong một transaction (REPEATABLE READ READ ONLY hoặc cùng `em`): `loadDataScope` → `assertCanRead` → đọc dữ liệu. Không tách kiểm tra quyền và đọc ra hai kết nối. Tải file: kiểm quyền rồi stream ngoài transaction là chấp nhận được (dữ liệu đã cấp tại thời điểm kiểm), nhưng không giữ gate khi stream (quy tắc (5) OA1.3).
3. **Action (ghi):** một transaction READ COMMITTED: `lockActor` (gate shared → `users`) hoặc `loadDataScope(m, uid, true)` **trước mọi row lock** → `loadDataScope(m, uid)` (đã giữ gate, mọi writer scope phải chờ) → khóa dòng chứng từ `FOR UPDATE` → `assertCanAct` trên dòng đã khóa → Business Rule → ghi. Kiểm scope **sau** khi khóa dòng để owner/người phụ trách không đổi giữa kiểm và ghi (chống TOCTOU).
4. **CREATE:** ngoài transaction chỉ để UX (`canAccessDraft` trên trạng thái dự kiến); trong transaction lưu bắt buộc lặp lại bước 3 với draft được dựng từ dữ liệu đã khóa/validate (đơn vị chịu trách nhiệm thuộc `orgUnitIds` hiện tại).
5. **Cấm:** cache `DataScope` qua request hoặc gắn vào `CurrentUser`; dùng scope nạp ngoài transaction để quyết định ghi; xin gate sau row lock; gọi mạng/xử lý file khi giữ gate.

- **Lưu ý bắt buộc OA3.3 (BA khi nghiệm thu OA3.2):**
  - Snapshot nhất quán phải bao gồm **cả** `loadDataScope` **và** truy vấn chứng từ. Cùng một transaction READ COMMITTED **không** mặc nhiên cho cùng snapshot (mỗi câu lệnh có snapshot riêng): đọc dùng REPEATABLE READ READ ONLY hoặc gộp một câu; ghi dựa vào gate shared (chặn writer scope) cộng khóa dòng chứng từ.
  - Action kiểm VIEW scope + action scope + Business Rule trên **dữ liệu đã khóa** (`FOR UPDATE` rồi mới `assertCanAct` và rule).
  - ASSIGNED phải kiểm thử trên workflow PR thật (node/assignee hiện tại và lịch sử), không chỉ bảng tạm.

**Acceptance OA3.3:**

- HĐ, PR khai báo `ScopeSource`; test mỗi scope trong `supported_scopes` của VIEW/action có cột tương ứng (không throw).
- List/COUNT/Detail/Notes/History/File cho cùng kết quả trên ma trận Role × scope × membership × cây; owner NULL không khớp O/T.
- Không có VIEW → 403; ngoài scope hoặc grant thiếu scope → 404; action ngoài scope → 403; Business Rule sau quyền.
- Action và CREATE kiểm lại trong transaction theo boundary trên; test đồng thời đổi scope/membership/cây với action: không deadlock, không commit thao tác trái scope.
- Xóa `OA3_DEFERRED`/`activeGrants` cùng commit bật lọc PR; gỡ đọc ngầm ADR-0014/0015; chặn F08/F09/F11/F12; `owner_org_unit_id` khi tạo (BA-OA3-06); H-01.
- ADMIN không bypass Business Rule.
- **Hướng dẫn OA3.3.** Mỗi module khai báo `ScopeSource` (HĐ: creator `created_by`, responsible Sales/PM phụ trách, orgUnit `owner_org_unit_id`; PR: creator, responsible của HĐ nguồn, assigned `EXISTS` node, orgUnit). List: `scopeFilter(..., first = số param hiện có + 1)` nối vào WHERE (cùng điều kiện cho count). Detail/Notes/History/File: `assertCanRead`. Action: `loadDataScope(m, uid, true)` hoặc sau `lockActor`, `assertCanAct` trước khi khóa dòng chứng từ, rồi Business Rule. CREATE: `canAccessDraft`, kiểm lại trong transaction. Cùng commit: xóa `OA3_DEFERRED`/`activeGrants`, gỡ đọc ngầm ADR-0014/0015, chặn F08/F09/F11/F12.

**Quyết định Architect tại OA1.2:** username không phân biệt hoa thường làm ở OA2 kèm preflight dữ liệu trùng; reset mật khẩu đồng thời mở khóa; sai mật khẩu hiện tại không tính vào khóa đăng nhập nhưng có rate limit riêng; mật khẩu 12–256 ký tự; scrypt chạy trong transaction khóa dòng user; `EMPLOYMENT_INACTIVE` thuộc OA2; hồ sơ cá nhân chỉ đọc.

**Chốt OA1.2 (F-OA1.2-01…09):**

- **Audit:** đăng nhập thất bại với username không tồn tại ghi vào bảng append-only `auth_events` (không phải Activity History vì không có target USER): sự kiện, nguyên nhân, SHA-256 của tên đã nhập (không lưu nguyên văn vì người dùng có thể gõ nhầm mật khẩu vào ô username), IP tối đa 45 ký tự.
- **Thời gian phản hồi:** mọi nhánh đăng nhập (không tồn tại, khóa, tắt, sai, đúng) chạy đúng một lần scrypt.
- **Rate limit** (bổ trợ, không thay khóa tài khoản), cửa sổ cố định trong bộ nhớ tiến trình, khóa theo dữ liệu đầu vào trước khi tra DB nên không lộ tài khoản tồn tại; vượt giới hạn trả 429 `TOO_MANY_ATTEMPTS`, không tính vào bộ đếm khóa:
  - `AUTH_LOGIN_LIMIT_PER_IP` mặc định 30 lần/phút/địa chỉ IP;
  - `AUTH_LOGIN_LIMIT_PER_ACCOUNT` mặc định 10 lần/phút/(IP, username);
  - `AUTH_PASSWORD_CHECK_LIMIT` mặc định 5 lần/15 phút/tài khoản cho kiểm tra mật khẩu hiện tại.
  - Giới hạn theo từng instance API và mất khi khởi động lại; chạy nhiều instance cần kho dùng chung.
- **Session trong transaction:** đổi mật khẩu kiểm tra lại session dưới khóa dòng user; reset/disable/enable/unlock khóa dòng actor và target theo thứ tự id (sau admin-guard khi có), kiểm tra lại session và `USER.MANAGE` của actor bằng `grantRole(lock)`. Request đã qua AuthGuard nhưng session bị thu hồi trước đó trả 401.
- **Frontend:** 401 chỉ xóa đúng token đã gửi request (401 muộn của phiên cũ không làm mất phiên mới); nhiều 401 đồng thời chỉ phát một sự kiện; logout lỗi mạng vẫn xóa phiên cục bộ và báo chưa xác nhận được với máy chủ; thông báo "Phiên đăng nhập không còn hiệu lực…" hiện một lần, không hiện khi chủ động đăng xuất hay đổi mật khẩu; dữ liệu cache của phiên cũ bị xóa. Mỗi tab giữ token riêng (`sessionStorage`).
- **UI:** Login rộng 420px, hiện/ẩn mật khẩu, dòng "Hệ thống quản lý doanh nghiệp" và "Quên mật khẩu? Liên hệ quản trị viên."; màn bắt buộc đổi mật khẩu cùng chiều rộng, nút Đăng xuất outlined, có hướng dẫn đăng nhập lại; menu tài khoản có chevron; dialog đổi mật khẩu 480px, hướng dẫn chính sách hiện sẵn dưới mật khẩu mới.

**Chốt OA1.3 (F-OA1.3-01…14):**

- **Lock graph (F-09).** Thứ tự khóa chung: admin-guard → `grants` (advisory) → dòng `users` (id tăng dần) → dòng `roles` → dòng grant/membership. Kiểm tra quyền trực tiếp (`grantRole(lock)`, PR workflow và `lockActor`) lấy `grants` dạng **shared**; mọi thao tác có thể thu hồi grant (ngừng Role, sửa quyền hoặc thành viên Role, tạo Role, vô hiệu hóa tài khoản) lấy `grants` **exclusive** trước khi chạm dòng nào. Lý do: câu `FOR SHARE` một lệnh khóa users/user_roles/roles/role_permissions theo thứ tự của plan, nên chỉ thống nhất "users trước roles" không đủ loại vòng chờ. Reset mật khẩu và mở khóa không thu hồi grant nên không lấy gate. Kiểm chứng PostgreSQL: ngừng Role và gỡ `PR.APPROVE` đồng thời với phê duyệt PR (3 vòng mỗi loại), đổi thành viên Role đồng thời với disable/reset cùng tài khoản, hai Admin gỡ nhau khỏi ADMIN, quyền người thao tác bị thu hồi khi đang chờ gate: không deadlock, không mất Admin cuối, không commit thao tác trái quyền.
- **Lock graph sau rà soát (F-OA1.3-21).** Gate `grants` là `pg_advisory_xact_lock[_shared]`: chỉ tồn tại trong transaction, tự giải phóng khi commit/rollback, không giữ qua request mạng hay ghi file (staging/tải hồ sơ không lấy gate; ghi file dossier dùng khóa advisory riêng theo khóa file). Shared/shared chạy song song (hai kiểm tra quyền, hai thao tác PR); shared/exclusive tuần tự hóa theo cả hai chiều. Một transaction giữ exclusive rồi xin shared không bị tự chặn và không phải nâng cấp khóa; không đường nào xin shared rồi mới xin exclusive. **Lỗi đã sửa:** `lockActor` (reset mật khẩu, mở khóa) từng khóa dòng `users` trước rồi mới lấy gate shared qua `grantRole`, đảo thứ tự với vô hiệu hóa tài khoản (gate exclusive → `users`); test đồng thời reset + mở khóa + vô hiệu hóa + đổi thành viên Role trên cùng tài khoản tái hiện `deadlock detected` mỗi lần chạy, nay `lockActor` lấy gate trước mọi dòng và test pass. Session và grant của người thao tác được kiểm lại sau khi có gate và khóa dòng; invariant nghiệp vụ (Admin cuối, tự thay đổi, version) kiểm trong cùng transaction trước commit.
- **Quy tắc bắt buộc OA2–OA4.** (1) Mọi đường thêm/gỡ Role của User, đổi trạng thái nhân sự/tài khoản, đổi Data Scope (OA3) hoặc thành viên nhóm ứng viên có thể làm mất quyền (OA4) lấy gate `grants` exclusive **trước** khi khóa dòng nào, sau admin-guard nếu có. (2) Mọi kiểm tra quyền trực tiếp trong transaction nghiệp vụ dùng `grantRole(lock)`/`lockActor` (gate shared trước dòng). (3) Không khóa dòng `users`/`roles`/grant rồi mới xin gate. (4) Không xin exclusive sau khi đã giữ shared trong cùng transaction. (5) Không gọi mạng hoặc xử lý file kéo dài khi đang giữ gate.
- **Version (F-10).** `PUT /admin/roles/:id` và `PATCH …/status` bắt buộc `version`; mọi thay đổi thông tin, quyền hoặc thành viên tăng `roles.version` một lần. **Quy tắc OA2:** đường thêm/gỡ Role từ màn Người dùng phải tăng `version` của từng Role bị đổi thành viên (và `users.version`), dưới cùng thứ tự khóa trên.
- **Catalog (F-11).** 51 key (OA2.1 thêm `ORGANIZATION.VIEW/MANAGE`, nay 53) khớp OA0/ADR-0018/04-PERMISSIONS. `admin_only` = `USER.*`, `ROLE.*`, `PR.CONFIGURE`, `DOSSIER_TYPE.MANAGE`, `DOSSIER_CONFIG.MANAGE` (theo BA-N-02, không theo hậu tố MANAGE: `PROCUREMENT_CATALOG.MANAGE`, `UOM.MANAGE`, `PR.REASSIGN`, `PR.DOSSIER_MANAGE`, `DOSSIER_TYPE.VIEW` cấp được cho Role nghiệp vụ). Chưa có trong catalog theo kế hoạch: `SALES_CONTRACT.CONFIGURE` (OA4), `SN_HISTORY.VIEW` (phase kho). Key legacy `SALES_CONTRACT.PROPOSE_PRODUCT/CONFIRM_PRODUCT` gỡ ở phase HĐ. Ma trận quyền khởi tạo không đổi trước khi BA duyệt (OA3).
- **Quyền hiệu lực ở frontend (F-12, F-20).** Có test tích hợp App + AppShell + router: focus lại cửa sổ ẩn nút thao tác khi mất `ROLE.MANAGE`; 403 khi mất `ROLE.VIEW` ẩn menu và route, phiên vẫn còn, không vòng lặp request; lưu Role xong menu dùng quyền mới. `/auth/me` được đọc lại khi: lưu Role/đổi trạng thái Role của chính phiên đó, cửa sổ được focus lại, màn hình mount lại, và khi một API trả 403 khác `PASSWORD_CHANGE_REQUIRED` (tối đa mỗi 2 giây). 403 không đăng xuất; 401 của token cũ vẫn bị bỏ qua (OA1.2). Giới hạn: quyền đổi bởi người khác chỉ hiện trên menu khi một trong các sự kiện trên xảy ra; backend luôn là nguồn quyết định.
- **Copy (F-13).** `copiedFrom` được đọc lại từ DB trong transaction: không tồn tại → `COPY_SOURCE_NOT_FOUND`; Role hệ thống → `SYSTEM_ROLE_PROTECTED`; metadata audit không nhận từ client.
- **User Picker (F-06, F-19).** `GET /admin/roles/user-options` phân trang/sort phía server (`q`, `sort`, `direction`, `page`, `size` 25/50/100); người thao tác bị loại trong SQL trước COUNT và phân trang (không thể tự đổi Role); người đã thuộc Role vẫn hiện nhưng bị khóa ở picker.
- **Lịch sử phía User (bắt buộc ở OA2).** Thêm/gỡ Role hiện chỉ ghi vào lịch sử Role; OA2 phải ghi thêm sự kiện tương ứng vào lịch sử từng User bị đổi Role, từ cả màn Role lẫn màn Người dùng.

**Chi tiết OA1.3:**

- **Quyền:** đọc cần `ROLE.VIEW`, thay đổi và User Picker cần `ROLE.MANAGE` (cả hai `admin_only`, nên chỉ ADMIN). Không có API tạo Permission key, cấp quyền trực tiếp cho User, kế thừa Role hay DENY.
- **Một transaction cho mỗi lần lưu** gồm thông tin Role, grant, liên kết User–Role và audit. Thứ tự khóa: admin-guard (chỉ khi đổi thành viên Role hệ thống) → dòng `users` của actor và user bị thêm/gỡ theo id → dòng `roles` (`FOR UPDATE`, kiểm `version`) → grant. Cùng thứ tự u → r với kiểm tra quyền trực tiếp của PR, nên không tạo vòng chờ. Session và `ROLE.MANAGE` của actor được kiểm lại trong transaction (`lockActor`, dùng chung với quản trị tài khoản OA1.2).
- **ADMIN:** chỉ sửa tên và mô tả; đổi quyền, ngừng hoạt động, đổi mã bị từ chối (`SYSTEM_ROLE_PROTECTED`, cộng trigger DB OA1.1); không có Copy trên UI. Gán/gỡ người dùng khỏi ADMIN được, trừ chính mình; gỡ thì kiểm `assertAdminRemains`.
- **Tự thay đổi:** actor không được thêm hoặc gỡ chính mình khỏi bất kỳ Role nào (`SELF_CHANGE_DENIED`).
- **Ngừng Role** giữ nguyên grant và liên kết User–Role; quyền hiệu lực mất/khôi phục từ request tiếp theo qua `v_user_grants`.
- **Copy** là Create được điền sẵn tên, mô tả, quyền; không sao chép mã, người dùng, cấu hình workflow, lịch sử. API ghi `ROLE_COPIED` với Role nguồn (không có endpoint copy riêng).
- **Lịch sử (target `ROLE`):** `ROLE_CREATED`, `ROLE_COPIED`, `ROLE_UPDATED` (before/after), `PERMISSIONS_ADDED/REMOVED`, `USERS_ADDED/REMOVED`, `ROLE_DEACTIVATED/ACTIVATED`. Không chứa thông tin bí mật.
- **Tab Người dùng** chỉ hiển thị thông tin tài khoản hiện có (username, họ tên, trạng thái); thông tin nhân sự và tổ chức thuộc OA2.

**Chi tiết OA1.2 so với §5:**

- So khớp username **phân biệt hoa thường** như baseline; không phân biệt hoa thường (BA-USR-02) đi cùng unique index ở OA2.
- Reset mật khẩu xóa bộ đếm và trạng thái khóa. Sai mật khẩu hiện tại khi tự đổi không tính vào khóa đăng nhập.
- Lần đăng nhập khi đang khóa hoặc tài khoản tắt được ghi `LOGIN_FAILED` (cause) nhưng không tăng bộ đếm. Username không tồn tại không ghi (không có target USER, không tạo user giả).
- ADMIN không tự reset mật khẩu (dùng đổi mật khẩu) và không tự tắt tài khoản (`SELF_CHANGE_DENIED`).
- `revoke_reason` chưa có `EMPLOYMENT_INACTIVE`; OA2 bổ sung cùng trạng thái nhân sự.
- Hồ sơ cá nhân ở OA1.2 chỉ đọc (họ tên, username, vai trò); sửa email/SĐT thuộc OA2.
- Tài khoản hiện có giữ nguyên hash và trạng thái khi migrate; user demo mới do seed tạo luôn phải đổi mật khẩu; fixture test đặt cờ riêng trong `bootTestApp`.

**Chi tiết OA2.1:**

- **Quyền:** đọc cần `ORGANIZATION.VIEW`, thay đổi cần `ORGANIZATION.MANAGE` (cả hai `admin_only`). Chức danh không liên kết quyền (BA-ORG-02, BA-ORG-08).
- **Dữ liệu:** mã 1–50 ký tự `[A-Za-z0-9][A-Za-z0-9_.-]*`, unique theo `lower(code)` (trùng → 409 `DUPLICATE_VALUE`), không đổi sau khi tạo; tên ≤ 200, mô tả ≤ 1000. Không xóa vật lý, không phân cấp.
- **Version:** `PUT /admin/job-titles/:id` và `PATCH …/status` bắt buộc `version` (lệch → 409 `VERSION_CONFLICT`); lưu không đổi gì thì không tăng version, không ghi lịch sử.
- **Lock graph:** thao tác chức danh không thu hồi grant nên dùng `lockActor` (gate `grants` shared → dòng `users` của actor → dòng `job_titles` `FOR UPDATE`); session và `ORGANIZATION.MANAGE` kiểm lại trong transaction.
- **Copy:** Create điền sẵn tên, mô tả, mã để trống, trạng thái hoạt động; `copiedFrom` đọc lại từ DB (`COPY_SOURCE_NOT_FOUND`).
- **Lịch sử (target `JOB_TITLE`):** `JOB_TITLE_CREATED`, `JOB_TITLE_COPIED` (kèm nguồn), `JOB_TITLE_UPDATED` (before/after), `JOB_TITLE_DISABLED`, `JOB_TITLE_ENABLED` (cột `action` tối đa 20 ký tự nên không dùng `…_DEACTIVATED`).
- **Ngừng chức danh (BA-UI-03):** điểm kiểm tra `assertJobTitleUnused` chạy dưới khóa dòng `job_titles`; chưa có `org_memberships` nên hiện chưa có gì để chặn. **Bắt buộc OA2.3:** bổ sung truy vấn membership ACTIVE của nhân sự ACTIVE (lỗi `JOB_TITLE_IN_USE`), ghi membership khóa dòng `job_titles` `FOR SHARE`, kèm test tích hợp, gồm **test đồng thời** ngừng chức danh và gán chức danh đó cho nhân sự (BA yêu cầu): không có membership ACTIVE trỏ tới chức danh INACTIVE, không deadlock.
- **UI:** Common List server-side (mã, tên, mô tả, trạng thái có Switch, thao tác Sửa/Sao chép), tìm mã/tên, lọc trạng thái, Làm mới; FormDialog mã 4/12, tên 8/12, mô tả 12/12, trạng thái; ngừng hoạt động có Confirm theo COMMON-CONFIRM-001: tiêu đề "Xác nhận ngừng sử dụng", description `mã · tên`, nút "Ngừng sử dụng" `submitAction="void"` (viền đỏ), nội dung nêu không ngừng được chức danh đang được nhân sự hoạt động sử dụng. Không dùng `CatalogPage` vì trang này lọc/phân trang phía client và không gửi `version`; trang ghép từ các Common component (`ListPageLayout`, `FilterToolbar`, `DataTable` server mode, `FormDialog`, `DocumentFormGrid`) theo mẫu Vai trò.

**Chi tiết OA2.2:**

- **Quyền:** đọc cần `ORGANIZATION.VIEW`, thay đổi cần `ORGANIZATION.MANAGE` (`admin_only`). Đơn vị không cấp quyền (BA-ORG-08).
- **Dữ liệu:** mã như chức danh (1–50 ký tự, unique theo `lower(code)`, không đổi sau khi tạo); tên ≤ 200, mô tả ≤ 1000; cây không giới hạn độ sâu; không xóa vật lý, không drag-and-drop.
- **Quy tắc cây:** cha phải tồn tại (`ORG_UNIT_PARENT_NOT_FOUND`) và đang hoạt động (`ORG_UNIT_PARENT_INACTIVE`); không tự làm cha, không chọn đơn vị thuộc cây con (`ORG_UNIT_CYCLE`, CTE đệ quy + CHECK DB); ngừng đơn vị còn con ACTIVE bị chặn (`ORG_UNIT_HAS_ACTIVE_CHILDREN`); kích hoạt chỉ khi cha ACTIVE. **Bất biến (BA xác nhận tại closure OA2.2):** không có đơn vị ACTIVE nằm dưới đơn vị INACTIVE (§4.3). Chuyển cha mang theo toàn bộ cây con.
- **Lock graph (rà soát cho OA2.3, khớp F-OA1.3-09/21).** Thứ tự toàn cục: admin-guard → gate `grants` (shared hoặc exclusive) → dòng `users` (id tăng dần) → dòng `roles` → advisory `org-tree` → dòng `org_units` → dòng `job_titles` → dòng `org_memberships`.
  - Thao tác đơn vị (OA2.2): `lockActor` (gate shared → `users` của actor `FOR SHARE`) → `org-tree` (exclusive, mọi thao tác ghi đơn vị) → `org_units` `FOR UPDATE` (kiểm `version`). Không giữ `org-tree` rồi mới xin gate, `users` hay `roles`.
  - Chức danh (OA2.1): gate shared → `users` → `job_titles` `FOR UPDATE`; không lấy `org-tree` (không đổi cây). Kiểm `JOB_TITLE_IN_USE` (OA2.3) chạy dưới khóa dòng chức danh.
  - Lưu User/membership (OA2.3): admin-guard (nếu đổi Role ADMIN/trạng thái) → gate exclusive nếu có thể thu hồi grant (đổi Role, trạng thái nhân sự/tài khoản), ngược lại shared → `users` (actor + user, id tăng dần) → `roles` (nếu đổi Role) → `org-tree` (nếu ghi membership hoặc head) → `org_units` `FOR SHARE` (đơn vị phải ACTIVE) → `job_titles` `FOR SHARE` (phải ACTIVE) → `org_memberships`. Gán/bỏ head: cùng thứ tự, `org_units` `FOR UPDATE`.
  - Không xung đột OA1.3: mọi đường xin `org-tree` sau gate/`users`/`roles` và không xin lại chúng sau đó, nên không có vòng chờ với lưu Role (gate → `users` → `roles`) hay thao tác tài khoản. Thao tác đơn vị giữ gate shared, nên lưu User đổi Role (gate exclusive) tuần tự hóa với nó; cả hai đều xin gate trước mọi dòng.
  - Không gọi mạng hay xử lý file trong khi giữ `org-tree` (cùng quy tắc với gate).
- **Version:** `PUT` và `PATCH …/status` bắt buộc `version` (409 `VERSION_CONFLICT`); lưu không đổi gì thì không tăng version, không ghi lịch sử.
- **Lịch sử (target `ORG_UNIT`):** `ORG_UNIT_CREATED` (after gồm cha), `ORG_UNIT_UPDATED` (before/after; có `parent` khi chuyển cha), `ORG_UNIT_DISABLED`, `ORG_UNIT_ENABLED`.
- **UI:** Tree (~30%, MUI List/Collapse, không dependency mới) + Detail Panel; tìm theo mã/tên giữ đường dẫn tổ tiên; mở/thu gọn từng nút và toàn bộ; Làm mới; đơn vị ngừng hiện màu mờ kèm "Ngừng dùng"; nút hiện số đơn vị con; mã · tên bị cắt thì có tooltip đầy đủ. Hai panel cùng chiều cao khả dụng, cuộn độc lập (toolbar cây và header chi tiết cố định). Detail: tên, mã, trạng thái; Ngừng/Kích hoạt (Confirm; Ngừng bị disable kèm tooltip khi còn con ACTIVE, backend vẫn kiểm), Thêm đơn vị con, Chỉnh sửa; tab Thông tin chung (mặc định), Nhân sự, Lịch sử (Common Activity History). FormDialog: mã 4/12 (chỉ khi tạo), tên 8/12, đơn vị cha (chỉ đơn vị ACTIVE, loại chính nó và cây con), trưởng đơn vị chỉ đọc, mô tả; trạng thái chỉ hiện ở Sửa (không hiện khi Tạo). Tab Thông tin chung có số đơn vị con trực tiếp. Nội dung hiển thị không dùng mã phase. Đổi cha mở Confirm "Xác nhận chuyển đơn vị cha" nêu cha cũ → mới và cảnh báo ảnh hưởng Phạm vi dữ liệu.
- **Sai khác so với §9 (chờ OA2.3):** nút cây chưa hiện số nhân sự; tab Nhân sự chỉ hiện thông báo; trưởng đơn vị chưa chọn được (không có membership để chọn hợp lệ, BA-ORG-10); `GET …/members` chưa có.
- **Acceptance chuyển tiếp bắt buộc OA2.3:** (1) `assertOrgUnitUnused`: chặn ngừng đơn vị còn membership ACTIVE (`ORG_UNIT_IN_USE`) + test đồng thời ngừng đơn vị và thêm membership vào đơn vị đó; (2) gán head: chỉ thành viên ACTIVE của đơn vị (BA-ORG-10), nhân sự ACTIVE; kết thúc membership của head bị chặn (BA-N-05); test đồng thời gán head và kết thúc membership người đó; (3) membership chỉ vào đơn vị ACTIVE, dưới `org-tree`; (4) số nhân sự trên nút cây, tab Nhân sự dùng chung API với màn User (BA-UI-09); (5) head/manager không cấp quyền (BA-ORG-08).

**Chi tiết OA2.3 (thống nhất cho OA2.3a–c; OA2.3a đã hiện thực):**

- **Quyết định BA tại OA2.3a:** (1) mã NV của user hiện có khai báo qua biến môi trường `EMPLOYEE_CODES` (JSON `{username: mã}`) khi chạy migration; thiếu user nào, mã trùng (không phân biệt hoa thường) hoặc mã sai định dạng thì migration dừng; không sinh mã. (2) Mã NV không sửa sau khi tạo. (3) Username không đổi sau khi cấp. (4) Seed: admin dùng `SEED_ADMIN_EMPLOYEE_CODE` (mặc định `ADMIN`), approver `SEED_APPROVER_EMPLOYEE_CODE` (mặc định `APPROVER`), user demo theo Role dùng mã Role.
- **Data model (migration `1733875200000`):** `users` thêm `employee_code` NOT NULL (định dạng như mã chức danh, unique `lower()`), `email`, `phone`, `employment_status` ACTIVE/INACTIVE, `created_at`, `created_by`, `updated_by`. `username`, `password_hash` cho phép NULL; unique cũ của `username` thay bằng `ux_users_username_ci` trên `lower(username)` (partial). CHECK: có username ⇔ có hash; tài khoản active ⇒ nhân sự ACTIVE (BA-USR-04) và có username. `user_sessions.revoke_reason` thêm `EMPLOYMENT_INACTIVE`. Preflight: username trùng theo hoa thường, mã NV thiếu/trùng. `down()` dừng nếu có nhân sự không tài khoản hoặc session revoke bởi `EMPLOYMENT_INACTIVE`. `v_user_grants` giữ nguyên: CHECK bảo đảm `is_active` kéo theo nhân sự ACTIVE và có username. Grant hiện có không đổi; key `USER.VIEW/MANAGE` có từ OA1.1.
- **API contract** (`USER.VIEW` cho GET, `USER.MANAGE` cho ghi; mọi ghi kiểm lại session và quyền trong transaction qua `lockActor`):

  | Method · Path | Body / Query | Kết quả, lỗi |
  |---|---|---|
  | `GET /admin/users` | `q` (mã NV, họ tên, username, email, SĐT), `employmentStatus`, `accountStatus` (ACTIVE/INACTIVE/LOCKED/NONE), `roleId`, `sort` (employeeCode, fullName, username, employmentStatus, accountStatus), `direction`, `page`, `size` 25/50/100 | `{items, total}`; item: id, employeeCode, fullName, email, phone, employmentStatus, username, accountStatus, version. Lọc theo đơn vị: OA2.3b |
  | `GET /admin/users/:id` | | + accountActive, mustChangePassword, lockedUntil, updatedAt, roles (chỉ đọc) |
  | `GET /admin/users/:id/history` | `before` | Common Activity History (target USER, gồm sự kiện bảo mật OA1.2) |
  | `POST /admin/users` | `{profile: {employeeCode, fullName, email?, phone?}, account?: {username, initialPassword}}` | `{id}`; nhân sự ACTIVE; có `account` thì tài khoản active + `must_change_password`. `EMPLOYEE_CODE_TAKEN`, `USERNAME_TAKEN` (409), `PASSWORD_POLICY` |
  | `PUT /admin/users/:id` | `{profile: {fullName, email?, phone?}, version}` | 204; gửi `employeeCode` → 400. `VERSION_CONFLICT`; tự sửa họ tên → `SELF_CHANGE_DENIED` (chỉ tự sửa email/SĐT, BA-USR-09) |
  | `PATCH /admin/users/:id/employment-status` | `{status, version}` | 204; INACTIVE tắt tài khoản + revoke toàn bộ session (`EMPLOYMENT_INACTIVE`); ACTIVE không bật tài khoản. `SELF_CHANGE_DENIED`, `LAST_ADMIN`, `VERSION_CONFLICT` |
  | `POST /admin/users/:id/account` | `{username, initialPassword, version}` | 204; `ACCOUNT_EXISTS`, `EMPLOYMENT_INACTIVE`, `USERNAME_TAKEN`, `VERSION_CONFLICT` |
  | OA1.2 giữ nguyên | `account`, `account-status`, `reset-password`, `unlock` | Bổ sung: bật tài khoản khi nhân sự INACTIVE → `EMPLOYMENT_INACTIVE`; bật/reset khi không có tài khoản → `NO_ACCOUNT` |

  **Mở rộng OA2.3b (không phá contract):** `POST`/`PUT /admin/users` nhận thêm `memberships[]`, `roleIds[]`, `warehouseIds[]`; thiếu trường = không đổi. Hồ sơ, membership, Role, Warehouse lưu trong **một** transaction, tăng `users.version` một lần.
- **Activity (USER):** `EMPLOYEE_CREATED` `{after}`, `EMPLOYEE_UPDATED` `{before, after}` chỉ các trường đổi, `EMPLOYEE_DEACTIVATED`/`EMPLOYEE_ACTIVATED` `{before, after: {employmentStatus, accountActive}}`, `ACCOUNT_CREATED` `{username}`, `SESSIONS_REVOKED` `{reason, count}`. Không ghi mật khẩu/hash. Lưu không đổi gì thì không ghi. Tên action ≤ 20 ký tự (cột `approval_histories.action`).
- **Login:** so khớp `lower(username)` (BA-USR-02); username lưu nguyên dạng nhập.
- **Transaction boundary và lock graph** (khớp OA2.2): tạo nhân sự, sửa hồ sơ, cấp tài khoản không thu hồi grant → `lockActor` (gate shared → dòng `users` của actor + target, id tăng dần) → kiểm `version`. Đổi trạng thái nhân sự → admin-guard → gate exclusive → `lockActor` → `version` → ghi → `assertAdminRemains` → revoke session, cùng transaction. **OA2.3b** nối tiếp cùng thứ tự: admin-guard (nếu đổi Role/trạng thái) → gate (exclusive nếu có thể thu hồi grant) → `users` → `roles` (tăng `roles.version` từng Role đổi thành viên) → `org-tree` → `org_units` `FOR SHARE` (`FOR UPDATE` khi gán head) → `job_titles` `FOR SHARE` → `org_memberships`.
- **Kiểm thử OA2.3a** (`user-admin.int.spec.ts`, 16 test): có/không tài khoản, cấp sau; unique mã NV/username không phân biệt hoa thường kể cả đồng thời; mã NV bất biến; version, audit before/after, rollback khi trùng; vòng đời nhân sự/tài khoản và session; CHECK DB; quyền `USER.*`, tự thay đổi, session bị thu hồi giữa chừng; đồng thời trên một nhân sự (version), đồng thời ngừng nhân sự + reset + mở khóa + tắt tài khoản (3 vòng, không deadlock); hai Admin cuối ngừng nhau → còn 1; preflight migration (username trùng hoa thường, thiếu mã, mã trùng), upgrade, down rồi up lại. Upgrade từ OA0 trong `authorization.int.spec.ts` khai báo `EMPLOYEE_CODES` và revert đến trước OA1.1.
- **Sai khác / giới hạn OA2.3a:** chưa có lọc theo đơn vị, cột đơn vị/chức danh chính; `LAST_ADMIN` qua ngừng nhân sự chỉ kiểm được bằng test đồng thời (người thao tác luôn là ADMIN và không tự ngừng); chưa có đường gỡ tài khoản khỏi nhân sự (BA chốt username không đổi; đường "username về NULL" ở §5.5 không mở). `account-status` (OA1.2) chưa nhận `version`.
- **Acceptance chuyển tiếp bắt buộc OA2.3b** (hoàn thành tại OA2.3b, đã nghiệm thu): (1) membership/Role/Warehouse trong lưu tập trung, atomic với hồ sơ, rollback toàn bộ; (2) chặn ngừng nhân sự đang là trưởng đơn vị hoặc quản lý trực tiếp (BA-N-06), dưới cùng khóa; (3) thêm/gỡ Role từ màn User: admin-guard + gate exclusive, `SELF_CHANGE_DENIED`, `LAST_ADMIN`, tăng `roles.version`, ghi lịch sử phía User và Role (cả từ màn Role); (4) Warehouse grant chỉ ADMIN, ghi Activity, chặn tự đổi; (5) toàn bộ acceptance OA2.1/OA2.2 ở trên (`JOB_TITLE_IN_USE`, `ORG_UNIT_IN_USE`, head chỉ từ thành viên, chặn kết thúc membership của head, test đồng thời); (6) lọc danh sách theo đơn vị, đơn vị/chức danh chính. **OA2.3c:** màn Người dùng List/Full Page, tab Nhân sự và số nhân sự trên cây, UI evidence.
- **Closure Review OA2.3a (BA F01–F04, không đổi source):**
  - **F01 → OA2.3b:** `account-status`, `reset-password`, `unlock` nhận `version` (409 `VERSION_CONFLICT`); mọi thay đổi trạng thái tài khoản tăng `users.version`. Hiện tại: bật/tắt và reset đã tăng `version`; mở khóa chưa tăng; chưa API nào trong ba API này nhận `version`.
  - **F02 đạt:** CHECK `chk_users_account_pair` (username ⇔ password_hash) và `chk_users_account_requires_employment`/`_username`, có test vi phạm trực tiếp bằng SQL. Backend chỉ ghi username/hash cùng nhau (tạo kèm tài khoản, cấp tài khoản); vô hiệu hóa chỉ đổi `is_active`, giữ nguyên thông tin xác thực (test OA1.2: bật lại thì đăng nhập được bằng mật khẩu cũ). Ngừng nhân sự: đăng nhập trả 401, token cũ trả 401, session revoke với `EMPLOYMENT_INACTIVE` (test vòng đời).
  - **F03 đạt:** fixture `account-security.int.spec.ts` đổi `employee_code` bằng SQL trực tiếp, chỉ dùng trong test. API không có đường sửa mã: `PUT` chứa `employeeCode` trả 400 (có test). Seed chỉ INSERT … `ON CONFLICT DO NOTHING`, không UPDATE user đã có.
  - **F04 đạt:** fresh (mọi suite khởi tạo schema mới + seed); upgrade với mapping hợp lệ (giữ username, gán mã, ACTIVE, giữ `is_active`); thiếu mapping, mã trùng không phân biệt hoa thường, username trùng theo hoa thường đều dừng, và schema giữ nguyên (cột chưa được thêm); `down()` rồi `up` lại, kể cả khi `up` dừng vì user mới chưa khai báo; upgrade từ OA0 → revert đến trước OA1.1 → up lại (`authorization.int.spec.ts`).
- **Acceptance OA2.3b bổ sung sau Closure Review:** (7) **Audit Role ở cả hai phía:** thêm/gỡ Role từ màn User hoặc màn Role đều ghi Activity trên USER (mỗi user bị đổi) và trên ROLE. (8) **Version:** mỗi lưu tăng `users.version` đúng một lần, và `roles.version` của từng Role đổi thành viên, dưới thứ tự khóa chung. (9) **Không tạo vòng quản lý trực tiếp** (BA-ORG-11): advisory `org-manager` + CTE, test đồng thời hai phép gán ngược chiều. (10) **Đúng một đơn vị chính** khi có membership ACTIVE (BA-ORG-04): partial unique ≤ 1, service kiểm ≥ 1 dưới khóa `users` trước commit, gồm khi kết thúc membership chính. (11) **Concurrency xuyên suốt** User, Role, Organization, Job Title: đúng một lock graph, có test đồng thời cho từng cặp (lưu User và lưu Role cùng user; lưu User và ngừng đơn vị/chức danh; gán head và kết thúc membership), không deadlock, không vi phạm invariant. (12) **Atomic save:** lỗi ở bất kỳ phần nào (membership, Role, Warehouse, `LAST_ADMIN`, version) thì rollback toàn bộ hồ sơ, grant, membership và audit; test bằng lỗi ở phần cuối của lần lưu. (13) F01.
- **OA2.3b (đã nghiệm thu):**
  - **Migration `1733961600000`:** bảng `org_memberships` (§4.3: `manager_user_id`, `is_primary`, `status` ACTIVE/ENDED, `started_at`/`ended_at`, `version`, audit cols), CHECK `chk_org_memberships_not_self_managed`, `chk_org_memberships_ended`; partial unique `ux_org_memberships_active_unit` (user, unit) và `ux_org_memberships_primary` (≤ 1 đơn vị chính); index theo đơn vị, manager, `org_units.head_user_id`. `down()` dừng khi đã có membership hoặc head (lịch sử tổ chức không xóa bằng rollback). Grant không đổi.
  - **API contract (bổ sung, không phá OA2.3a):**

    | Method · Path | Thay đổi |
    |---|---|
    | `POST /admin/users`, `PUT /admin/users/:id` | Nhận thêm `memberships?: [{orgUnitId, jobTitleId, managerUserId?, isPrimary}]` (tập membership ACTIVE mong muốn, khóa theo đơn vị; đơn vị bị bỏ → `ENDED`), `roleIds?: number[]`, `warehouseIds?: number[]`; thiếu trường = không đổi. Lỗi: `PRIMARY_ORG_UNIT_REQUIRED`, `MEMBERSHIP_DUPLICATE_UNIT`, `ORG_UNIT_NOT_FOUND`, `ORG_UNIT_INACTIVE`, `JOB_TITLE_NOT_FOUND`, `JOB_TITLE_INACTIVE`, `MANAGER_SELF`, `MANAGER_NOT_FOUND`, `MANAGER_INACTIVE`, `MANAGER_CYCLE`, `ORG_UNIT_HEAD_MEMBERSHIP`, `UNKNOWN_ROLE`, `NO_ACCOUNT` (gán Role cho nhân sự không tài khoản), `UNKNOWN_WAREHOUSE`, `SELF_CHANGE_DENIED`, `LAST_ADMIN`, `VERSION_CONFLICT` |
    | `GET /admin/users` | Query `orgUnitId` (membership ACTIVE); item thêm `primaryOrgUnit`, `primaryJobTitle` |
    | `GET /admin/users/:id` | Thêm `memberships[]` (ACTIVE: orgUnit, jobTitle, isPrimary, manager, isHead, startedAt, version), `warehouses[]` |
    | `PATCH /admin/users/:id/employment-status` | INACTIVE bị chặn khi là trưởng đơn vị (`EMPLOYEE_IS_HEAD`) hoặc quản lý trực tiếp của membership ACTIVE (`EMPLOYEE_IS_MANAGER`) |
    | `PATCH …/account-status`, `POST …/reset-password`, `POST …/unlock` | **F01:** bắt buộc `version` (thiếu → 400, lệch → 409 `VERSION_CONFLICT`); mở khóa nay tăng `users.version` |
    | `PUT /admin/org-units/:id` | Nhận thêm `headUserId?` (thiếu = giữ, `null` = bỏ). Lỗi `HEAD_NOT_FOUND`, `HEAD_INACTIVE`, `HEAD_NOT_MEMBER`. Lịch sử `ORG_UNIT_UPDATED` có `head` before/after |
    | `GET /admin/org-units/:id` | Thêm `head {id, employeeCode, fullName}` |
    | `GET /admin/org-units/tree` | Mỗi nút thêm `memberCount` (membership ACTIVE) |
    | `GET /admin/org-units/:id/members` (mới, `ORGANIZATION.VIEW`) | Thành viên ACTIVE: nhân sự, chức danh, chính/phụ, manager, isHead; cùng tập người với `GET /admin/users?orgUnitId=` (BA-UI-09) |
    | `PUT /admin/roles/:id`, `POST /admin/roles` | Contract giữ nguyên; nay tăng `users.version` và ghi lịch sử USER cho từng user bị thêm/gỡ |
    | `PATCH /admin/job-titles/:id/status`, `PATCH /admin/org-units/:id/status` | Chặn `JOB_TITLE_IN_USE` (membership ACTIVE của nhân sự ACTIVE), `ORG_UNIT_IN_USE` (membership ACTIVE bất kể trạng thái nhân sự) |
  - **Activity:** USER: `ROLES_ADDED`/`ROLES_REMOVED` `{roles}`, `MEMBERSHIPS_CHANGED` `{added, updated:[{before, after}], ended}`, `WAREHOUSES_CHANGED` `{added, removed}`; ROLE: `USERS_ADDED`/`USERS_REMOVED` cả khi đổi từ màn User. Một lần lưu tăng `users.version` đúng một lần; lưu không đổi gì không tăng, không ghi.
  - **Lock graph (đã rà mọi luồng ghi):** lưu User: admin-guard (khi có `roleIds`) → gate exclusive (khi có `roleIds`/`warehouseIds`; tạo mới khi danh sách không rỗng), ngược lại shared → `users` FOR UPDATE (actor, nhân sự, mọi manager trong body; id tăng dần) → `roles` FOR UPDATE (Role đổi thành viên, tăng `roles.version`) → `org-tree` → `org_units` FOR SHARE → `job_titles` FOR SHARE → `org_memberships` FOR UPDATE → `user_warehouses` → `assertAdminRemains`. Gán head: `lockActor` (gate shared → `users` actor + head FOR SHARE) → `org-tree` → `org_units` FOR UPDATE. Ngừng nhân sự: admin-guard → gate exclusive → `users` FOR UPDATE → kiểm head/manager (mọi phép gán head/manager khóa dòng `users` của người đó trước, nên không race). Lưu Role: admin-guard (Role hệ thống) → gate exclusive → đọc thành viên hiện tại **dưới gate** (trước đây đọc trước gate) → `users` FOR UPDATE của user bị đổi → `roles`. Chức danh/đơn vị giữ nguyên thứ tự OA2.1/OA2.2. **Closure F05:** bỏ `org-manager` — `saveMemberships` là đường duy nhất ghi `manager_user_id` và luôn lấy `org-tree` exclusive trước khi đọc chuỗi manager, nên `org-tree` đã tuần tự hóa mọi thay đổi quan hệ quản lý; test hai phép gán ngược chiều vẫn pass. Kích hoạt lại nhân sự: admin-guard → gate exclusive → `users` FOR UPDATE (nhân sự + manager của membership ACTIVE) → `org-tree` → `org_units`, `job_titles` FOR SHARE. Membership API: gate shared → `users` FOR UPDATE (actor, nhân sự, manager mới) → cùng thứ tự `saveMemberships`.
  - **Kiểm thử:** `user-membership.int.spec.ts` (20 test, PostgreSQL thật); `org-unit-admin`, `authorization`, `account-security`, `user-admin`, `procurement` cập nhật theo F01/migration mới. Đồng thời (3 vòng mỗi cặp): ngừng chức danh ↔ gán chức danh; ngừng đơn vị ↔ thêm membership; gán head ↔ kết thúc membership; hai phép gán manager ngược chiều (đúng một `MANAGER_CYCLE`); ngừng nhân sự ↔ gán làm manager; lưu User ↔ lưu Role cùng user ↔ ngừng chức danh ↔ ngừng đơn vị; hai lần lưu đặt đơn vị chính khác nhau; hai Admin gỡ ADMIN của nhau qua lưu User (còn 1). Atomic: lỗi ở phần cuối (`UNKNOWN_WAREHOUSE`), `VERSION_CONFLICT`, `UNKNOWN_ROLE` → hồ sơ, Role, `roles.version`, membership, lịch sử USER/ROLE không đổi. Migration: fresh, down → up, CHECK/unique, `down()` dừng khi có dữ liệu; upgrade OA0 → revert → up (`authorization.int.spec.ts`).
  - **Sai khác / giới hạn (sau Closure Patch):** `LAST_ADMIN` qua lưu User chỉ kiểm được bằng test đồng thời (actor luôn là ADMIN và không tự đổi); head không đổi qua lưu User (gán tại đơn vị). Các mục kích hoạt lại, Membership API, Warehouse và `org-manager` đã xử lý ở Closure Patch.
  - **Closure Patch OA2.3b (BA/Architect F01–F05, đã nghiệm thu):**
    - **F01 Kích hoạt lại nhân sự:** `PATCH …/employment-status` ACTIVE kiểm mọi membership ACTIVE: đơn vị ACTIVE (`ORG_UNIT_INACTIVE`), chức danh ACTIVE (`JOB_TITLE_INACTIVE`), manager là nhân sự ACTIVE (`MANAGER_INACTIVE`); 409, không tự sửa dữ liệu. Nhân sự INACTIVE vẫn sửa được membership (lưu User hoặc Membership API) để khắc phục; chỉ phần đổi/mới bị kiểm, phần giữ nguyên không chặn. Test: chặn → sửa chức danh → kích hoạt; manager INACTIVE (dữ liệu SQL tay); đồng thời kích hoạt ↔ ngừng chức danh ↔ ngừng đơn vị (3 vòng): không có nhân sự ACTIVE trên chức danh/đơn vị INACTIVE.
    - **F02 Membership API (§6, `ORGANIZATION.MANAGE`):** `POST /admin/memberships` `{userId, orgUnitId, jobTitleId, managerUserId?, isPrimary, version}` (version nhân sự) → 201 `{id}`; `PUT /admin/memberships/:id` `{jobTitleId, managerUserId?, isPrimary, version}` (version membership) → 204; `POST /admin/memberships/:id/end` `{version}` → 204. `isPrimary: true` chuyển đơn vị chính sang membership này; kết thúc đơn vị chính khi còn membership khác → `PRIMARY_ORG_UNIT_REQUIRED` (chọn đơn vị chính khác trước); sửa/kết thúc membership đã ENDED → `MEMBERSHIP_ENDED`. Mỗi API chỉ dựng tập membership mong muốn rồi gọi cùng `saveRelations`/`saveMemberships` với lưu User: cùng validation, audit `MEMBERSHIPS_CHANGED`, `SELF_CHANGE_DENIED`, tăng `users.version` một lần, lock graph. Test: luồng thêm/sửa/kết thúc, version, các guard, đồng thời Membership API ↔ lưu User cùng nhân sự (đúng một thắng, bên kia `VERSION_CONFLICT`).
    - **F03 Contract membership (BA duyệt):** `memberships[]` và `headUserId` qua `PUT /admin/org-units/:id` giữ như trên. Không gửi `memberships` → giữ nguyên; `[]` → kết thúc toàn bộ; có danh sách → đồng bộ theo tập mong muốn. Kết thúc là `ENDED` + `ended_at`, không xóa; gia nhập lại đơn vị tạo dòng mới, dòng ENDED giữ nguyên (test).
    - **F04 Warehouse:** `warehouses.is_active` có sẵn. Cấp mới kho đã ngừng → 409 `WAREHOUSE_INACTIVE`; kho đã cấp vẫn giữ khi lưu hồ sơ (không đổi danh sách) và gỡ được (test).
    - **F05 Lock graph:** bỏ `org-manager` (xem lock graph ở trên).
    - **Kiểm thử cuối:** full API regression 244/244 (18 suite, PostgreSQL Test DB), API build, `git diff --check` sạch sau Closure Patch. Kiểm thử chuyển đơn vị chính bổ sung sau đó (không đổi source): `user-membership.int.spec.ts` 30/30 — `PUT …/memberships/:id` `isPrimary: true` hạ đơn vị chính cũ trong cùng transaction (version cả hai membership +1, `users.version` +1, một `MEMBERSHIPS_CHANGED` đủ before/after, kết thúc được đơn vị chính cũ); đồng thời với lưu User kiểm chủ động cả hai thứ tự commit (PUT trước → lưu User `VERSION_CONFLICT`; lưu User trước → cả hai 204, giữ đủ hai thay đổi) và 3 vòng đồng thời thật, mỗi kết quả kiểm trạng thái cuối, version, audit, đúng một đơn vị chính.

- **OA2.3c (triển khai xong, chờ BA review UI/UX):**
  - **Người dùng · List** (`UsersPage`): Common List, trạng thái trên URL; cột Mã NV, Họ tên, Username, Email, SĐT, Đơn vị chính, Chức danh chính, Nhân sự, Tài khoản (hai badge riêng, BA-USR-03); lọc từ khóa, đơn vị, vai trò, trạng thái nhân sự, trạng thái tài khoản; sort server; Làm mới; thao tác dòng Chỉnh sửa; Back giữ trạng thái list.
  - **Người dùng · Create/View/Edit** (`UserDetail`): COMMON-DETAIL-PAGE-001, 5 tab. Một draft cho mọi tab, một nút Lưu gửi `POST`/`PUT /admin/users` (profile + `memberships`/`roleIds`/`warehouseIds`, chỉ gửi danh sách đã đổi, kèm `version`). Đổi Role/Kho có Confirm (COMMON-CONFIRM-001). Validation FE-VALIDATION-001; lỗi trùng mã NV/username/mật khẩu gắn vào trường; lỗi membership/role/kho mở đúng tab. 409 `VERSION_CONFLICT` giữ nguyên draft và hướng dẫn tải lại. Dirty Guard khi rời trang. Tự sửa: chỉ email/SĐT; tab quan hệ và thao tác tài khoản/nhân sự ẩn hoặc chỉ đọc (`SELF_CHANGE_DENIED`).
  - **Tài khoản** (khối trong Thông tin chung, chỉ ở View): Cấp tài khoản, Đặt lại mật khẩu, Bật/Tắt, Mở khóa (khi LOCKED), mỗi thao tác một Confirm, gửi `version`. Footer View: Ngừng/Kích hoạt nhân sự (Confirm nêu hệ quả; kích hoạt không bật tài khoản, BA-USR-04).
  - **Tổ chức/Vai trò/Phạm vi dữ liệu:** bảng membership + Membership Dialog dùng chung; chặn kết thúc membership của trưởng đơn vị và đơn vị chính khi còn đơn vị khác; đơn vị đầu tiên luôn là chính. Role Picker, Kho Picker (chỉ cấp mới kho ACTIVE; kho đã cấp vẫn hiện). Phạm vi dữ liệu chỉ có Warehouse Grant (effective-access thuộc OA3).
  - **Cơ cấu tổ chức:** nút cây hiện số nhân sự (`memberCount`); Thông tin chung có trưởng đơn vị và số nhân sự; Ngừng bị khóa khi còn nhân sự (tooltip); form Sửa chọn trưởng đơn vị từ thành viên ACTIVE (`headUserId`); tab Nhân sự (`GET …/members`) thêm/sửa/kết thúc qua Membership API với cùng dialog.
  - **Common:** `ActivityHistoryTable` thêm `formatItem` (mục lồng như membership) và hiển thị giá trị đối tượng (trưởng đơn vị before/after) thay vì JSON.
  - **Sai khác / giới hạn:** (1) `GET …/members` không trả id/version membership, nên Sửa/Kết thúc ở tab Nhân sự đọc `GET /admin/users/:id` trước (cần `USER.VIEW`; cả hai quyền đều `admin_only` nên không đổi phạm vi thực tế) — đề xuất BA cân nhắc bổ sung vào contract. (2) Role picker/bộ lọc vai trò và danh sách chức danh tải tối đa 100 mục (ghi `shortcut:` trong code). (3) Lịch sử `ACCOUNT_CREATED` không hiện username (metadata dạng trường đơn).
  - **Kiểm thử:** Web 149/149 (20 file, có `users.test.tsx` 8 test: list/filter, create atomic, edit + confirm + version, 409 giữ draft, unlock có version, quyền xem, tab Nhân sự kết thúc qua Membership API, `applyMembership`), Web build, `git diff --check`. Browser Chromium 1366×768 trên Test DB `mini_erp_test` (API 3199/Web 5199), không lỗi console. Ảnh: `docs/screenshots/oa2.3c/01…17`.
  - **Closure Patch OA2.3c (BA/Architect F01–F12, chờ Closure Review):**
    - **F01** List: toolbar một hàng ở 1366×768 (Làm mới có chữ); placeholder "Nhập mã NV, họ tên…"; cột Mã NV, Họ tên, Tên đăng nhập, Đơn vị chính, Chức danh chính, Nhân sự, Tài khoản, Email, SĐT, Thao tác (độ rộng cố định, cuộn ngang).
    - **F02** Badge Tài khoản căn giữa theo hàng ô 40px; thuật ngữ Khóa tạm thời, Vô hiệu hóa/Kích hoạt tài khoản, Ngừng làm việc, Kích hoạt lại nhân sự (nhãn, xác nhận, kết quả, lịch sử, i18n).
    - **F03** Hướng dẫn tab Tổ chức theo BA; đơn vị là link sang Cơ cấu tổ chức (chỉ khi có `ORGANIZATION.VIEW`; Dirty Guard hỏi khi đang sửa); dấu check cho Đơn vị chính và Trưởng đơn vị ở cả User và Organization.
    - **F04** Membership Dialog không lặp đơn vị; đơn vị đầu tiên tự là chính và khóa; không bỏ chọn đơn vị chính hiện tại; chọn đơn vị phụ làm chính hiện thông báo đơn vị chính cũ thành kiêm nhiệm; User: Áp dụng (lưu cùng User), Organization: Lưu phân công (gọi API ngay).
    - **F05** Bỏ mọi giới hạn 100: bộ lọc Vai trò và Chức danh dùng `ServerAutocomplete` (tìm phía server), Role Picker phân trang/tìm phía server, giữ lựa chọn qua trang/tìm kiếm (test 130 vai trò). Kho: API trả toàn bộ danh sách, không giới hạn.
    - **F06** Hướng dẫn Phạm vi dữ liệu theo BA; không làm Data Scope OA3.
    - **F07** Lịch sử User: hiện username của Cấp tài khoản và số phút khóa; thời gian đến giây; Khóa tạm thời hiển thị "Hệ thống (tự động, tài khoản …)" — chỉ nhãn hiển thị, audit gốc giữ nguyên actor. Không hiện/ghi dữ liệu mật khẩu.
    - **F08** Create dùng `PasswordField` OA1.2 (hiện/ẩn), chính sách mật khẩu hiện sẵn, checkbox tạo tài khoản mặc định không chọn; test validation, focus và giữ dữ liệu khi chuyển tab.
    - **F09** Nút mở/thu gọn toàn bộ của cây: KeyboardDoubleArrowDown/Up, 32×32, màu trung tính, tooltip (FRONTEND.md "Tree View").
    - **F10** Tab "Nhân sự (n)", tìm theo mã NV/họ tên, bỏ ghi chú kỹ thuật; cột Mã NV, Họ tên, Đơn vị chính, Trưởng đơn vị, Chức danh, Quản lý trực tiếp, Nhân sự, Từ ngày. Cây mở/thu gọn, đơn vị đang chọn và tab giữ nguyên sau thêm/sửa/kết thúc và Làm mới (kiểm trên trình duyệt).
    - **F11** `GET /admin/org-units/:id/members` thêm `membershipId`, `membershipVersion` (không đổi quyền, không migration); frontend dùng trực tiếp, bỏ `GET /admin/users/:id`. Test contract, 403 cho người không có `ORGANIZATION.VIEW`, version cũ → 409.
    - **F12** Seed demo: không phải regression OA2.3a/b. Điều kiện có từ `d090b29` (trước OA): cần cấu hình nhóm ứng viên PR SALES và RECEIPT (`PUT /pr-workflow/routes/:route`) trước khi chạy; trên Test DB mới sau khi cấu hình, `pnpm seed:demo` chạy thành công. Đã ghi điều kiện vào chú thích `seed-demo.ts`; không nới ràng buộc, không tạo dữ liệu thay thế.
    - Xác nhận đổi Vai trò/Kho vẫn tính diff giữa dữ liệu ban đầu và bản nháp cuối; atomic save, Dirty Guard, phân quyền và `VERSION_CONFLICT` giữ nguyên (test).
    - **Kiểm thử:** Web 153/153 (20 file; `users.test.tsx` 12 test), Web build; API 249/249 (18 suite, Test DB), API build; `git diff --check`. Browser 1366×768 trên Test DB, không lỗi console; server test đã dừng. Ảnh: `docs/screenshots/oa2.3c/closure-patch/01…09`.
- **Hoàn tất OA2.3c (BA duyệt Closure Patch):** đồng bộ thuật ngữ tiếng Anh với tiếng Việt (Employment ended, Deactivate/Activate account, Temporarily locked, End employment, Reactivate employee) ở trạng thái, thao tác tài khoản, xác nhận, kết quả, lịch sử; mã NV dài dùng `GridText` (ellipsis + tooltip); điều kiện seed demo ghi trong README (Run locally). BA chấp nhận màu placeholder "Tất cả" của bộ lọc Vai trò và cuộn ngang bảng.  - **Technical debt (BA ghi nhận):** lịch sử `LOGIN_FAILED` (và `ACCOUNT_LOCKED`) ghi actor là chính tài khoản bị thử đăng nhập; cần tách "tài khoản bị thử" với "người thực hiện thực tế" (ẩn danh/IP) ở lần sửa audit sau. UI hiện chỉ đổi nhãn actor của `ACCOUNT_LOCKED` thành Hệ thống.

- **OA2.4 Personal Profile & Integration (hoàn thành, BA đã nghiệm thu; OA2 hoàn thành):**
  - **API:** `GET /me` (đăng nhập; cùng dữ liệu với chi tiết User: nhân sự, tài khoản, đơn vị/chức danh chính, membership kèm quản lý trực tiếp và trưởng đơn vị, vai trò, kho; không có mật khẩu/hash). `PATCH /me` `{email?, phone?, version}`: BA-USR-09 do backend thực thi — DTO whitelist + `forbidNonWhitelisted` trả 400 cho mọi trường khác (họ tên, mã NV, vai trò, membership, username, trạng thái); không cần quyền `USER.*`; `lockActor(…, null)` giữ cùng gate → khóa dòng `users` → kiểm phiên của các luồng ghi khác; `VERSION_CONFLICT` theo `users.version` chung với lưu User (một bên đổi thì bên kia 409); không đổi gì thì không tăng version, không ghi lịch sử; audit `EMPLOYEE_UPDATED` before/after, actor là chính người dùng. Cả hai bị chặn khi `must_change_password` (`PASSWORD_CHANGE_REQUIRED`).
  - **UI:** menu tài khoản (Hồ sơ cá nhân, Đổi mật khẩu, Đăng xuất). Hồ sơ cá nhân là `FormDialog`: thông tin nhân sự, tài khoản, đơn vị chính, chức danh chính, bảng phân công (đơn vị, chức danh, quản lý trực tiếp, check đơn vị chính, từ ngày), vai trò chỉ đọc (`ReadOnlyField`); chỉ Email/SĐT sửa được, validation inline, Dirty Guard, Action Result, 409 giữ dữ liệu nhập. Đổi mật khẩu dùng nguyên `ChangePasswordDialog` OA1.2 (không nhân bản).
  - **Tích hợp (test `personal-profile.int.spec.ts`, 5 test, PostgreSQL):** hồ sơ đọc đúng dữ liệu tổ chức/vai trò/kho; thêm membership từ phía đơn vị (Membership API) đổi đơn vị chính và quản lý trực tiếp trên hồ sơ, tab Nhân sự thấy cùng người; đổi tên chức danh hiển thị ngay (tham chiếu, không sao chép); gỡ khỏi vai trò từ màn Role làm mất quyền ở request tiếp theo và ghi `ROLES_REMOVED`; version chung hai chiều hồ sơ ↔ quản trị; reset mật khẩu, vô hiệu hóa tài khoản, ngừng làm việc đóng phiên (401); kích hoạt lại nhân sự không bật tài khoản, token cũ không sống lại.
  - **Kiểm thử:** API 254/254 (19 suite, Test DB), API build; Web 155/155 (20 file), Web build; `git diff --check`. Browser 1366×768 trên Test DB với người dùng không quản trị (không thấy menu Hệ thống) và admin; không lỗi console; server test đã dừng. Ảnh `docs/screenshots/oa2.4/01…06`.
- **Closure Patch OA2.4 (BA F01–F05, chờ Closure Review cuối, chưa commit; không đổi backend):**    - **F01** Hồ sơ cá nhân giữ Common FormDialog (~900px, co theo màn hình), 3 tab Thông tin chung (mặc định) / Tổ chức / Vai trò, footer cố định; một bản nháp cho mọi tab nên chuyển tab giữ dữ liệu đang nhập; chỉ Email/SĐT sửa được.    - **F02** Bỏ dòng "mã NV · họ tên" trên form và helper của Họ tên; một hướng dẫn chung "Bạn có thể cập nhật email và số điện thoại. Các thông tin khác do quản trị viên quản lý."    - **F03** Bảng phân công có cột Trưởng đơn vị (dấu check như màn User/Organization), lấy `isHead` có sẵn của `GET /me`. Kho được cấp chưa hiển thị (xem xét tại OA3).    - **F04** Lưu chỉ khả dụng khi có thay đổi; Dirty Guard của FormDialog khi đóng bằng X, Escape, Hủy bỏ, backdrop; `VERSION_CONFLICT` giữ dữ liệu nhập, không tự tải lại/thử lại; lưu thành công hiện Action Result, đóng kết quả thì đóng Hồ sơ và trở về màn hình đang làm (URL, tìm kiếm giữ nguyên); mỗi lần mở lại đọc `GET /me` mới (`gcTime: 0`, `refetchOnMount: 'always'`, chỉ hiển thị dữ liệu lấy sau khi mở).    - **F05 (ghi nhận, không làm):** empty state Hợp đồng bán hướng dẫn tạo hợp đồng dù người dùng có thể thiếu quyền CREATE → xử lý tại OA6.    - **Kiểm thử:** Web 158/158 (20 file; `account.test.tsx` 5 test hồ sơ: tab và giữ nháp, Lưu khi có thay đổi + version + đóng sau kết quả, Dirty Guard Hủy bỏ/Escape, 409 không retry, mở lại đọc mới), Web build, `git diff --check`. API không đổi nên không chạy lại (OA2.4: 254/254). Browser 1366×768 trên Test DB (người dùng không quản trị), không lỗi console. Ảnh `docs/screenshots/oa2.4/closure-patch/01…05`.  - **Sai khác / giới hạn (BA chấp nhận):** Hồ sơ là FormDialog theo BA-UI-07; chiều cao hộp thoại co giãn theo nội dung từng tab (footer luôn ở đáy hộp thoại); giữ hướng dẫn chung hiện tại.
**Quyết định Architect tại OA1.1:**

- Authorization là module hàm nhận `EntityManager`, không phải Nest provider.
- Bảo vệ Role ADMIN bằng trigger DB.
- `supported_scopes` thuộc OA3; `permissions.sort_order` thuộc OA1.3 (Permission Catalog UI).
- **Bảo vệ Admin cuối cùng** (§5.5) triển khai ngay tại phase đầu tiên có API làm thay đổi trạng thái hoặc quyền của Admin. Nếu OA1.2 có đường như vậy (ví dụ vô hiệu hóa tài khoản), guard phải có trong OA1.2, không chờ OA1.3.

**OA1.1 (đã đạt)**

- Fresh migration và upgrade từ baseline OA0 trên PostgreSQL Test; snapshot role→permission và user→permission chỉ khác ở loại đã duyệt (ADMIN nhận `USER.*`, `ROLE.*`); chạy lại migration không có thay đổi; `down`/`up` khôi phục đúng snapshot.
- `v_user_grants` và `grantRole(lock)` cho cùng kết quả; Role inactive không cấp quyền; thu hồi Role, membership, Permission có hiệu lực từ request tiếp theo.
- `FOR SHARE` chặn mọi đường thu hồi khi action giữ grant; thu hồi commit trong lúc chờ được thấy sau khi chờ; không deadlock.
- HTTP: phê duyệt PR đồng thời với ngừng Role hoặc gỡ `PR.APPROVE` → 403, trạng thái PR, Activity và Notification không đổi; khi thu hồi rollback → 204, chuyển bước, có Activity APPROVE và task tiếp nhận.
- Role thường không nhận `admin_only` (INSERT và UPDATE); ADMIN không bị gỡ, chuyển, ngừng, đổi mã hay xóa grant; không nâng Role thường thành hệ thống; ADMIN sửa được tên, mô tả.
- Chạy lại seed không khôi phục Permission, membership, kho, không kích hoạt lại Role, không đổi tên Role, không đặt lại mật khẩu.
- Test kiến trúc: không JOIN grant ngoài module Authorization.

### 11.1 Acceptance criteria

**OA1**

- Snapshot (a)(b) chỉ khác ở loại "đã duyệt".
- Role ngừng hoạt động mất quyền ngay, kể cả trong pool PR và action PR đang chờ khóa.
- Không còn JOIN grant ngoài Authorization.
- `lockGrant` và `v_user_grants` cho cùng kết quả.
- Logout chỉ revoke phiên hiện tại; phiên khác vẫn chạy.
- Đổi hoặc reset mật khẩu, tắt tài khoản thì mọi phiên trả 401.
- Bật lại tài khoản, token cũ vẫn 401.
- Đổi mật khẩu (thường và bắt buộc) thu hồi mọi phiên kể cả phiên hiện tại, không trả token, UI về Đăng nhập.
- Mật khẩu dưới 12 ký tự bị từ chối ở FE và BE.
- Sai 5 lần liên tiếp thì khóa 15 phút; ADMIN mở khóa được và thấy trạng thái khóa; thông báo đăng nhập không lộ khóa.
- `must_change_password` chặn API, và màn đổi mật khẩu hoạt động.
- **Concurrency (F-OA0-04):** login đồng thời với reset mật khẩu hoặc disable không để lại session hợp lệ dùng thông tin cũ; hai lần đổi mật khẩu đồng thời được tuần tự hóa; N lần sai đồng thời tăng bộ đếm đúng N.
- **Kiểm chứng PostgreSQL (BA-N-04):** `v_user_grants` và `lockGrant` cho cùng kết quả; `lockGrant` chặn ngừng Role giữa action PR; admin-guard tuần tự hóa hai request gỡ Admin.
- Login thành công/thất bại và sự kiện bảo mật được ghi, không có bí mật (BA-N-09).
- Không gán được `admin_only` cho Role thường; `PR.REASSIGN`, `PR.DOSSIER_MANAGE`, `DOSSIER_TYPE.VIEW` gán được (BA-N-02).
- Role List, Role View/Edit, Copy Role đúng §9; Role ADMIN sửa được tên, mô tả, không sửa được thuộc tính hệ thống.
- ADMIN không tự gỡ Role hay tự tắt tài khoản.
- Admin cuối được bảo vệ trên mọi đường, kể cả đồng thời.
- Seed chạy hai lần không đổi grant.
- Audit có before/after, không có hash.

**OA2**

- Username trùng theo hoa thường bị từ chối. Mã NV không tái sử dụng được.
- Migration dừng khi còn user thiếu mã.
- Ngừng nhân sự thì tắt tài khoản và revoke phiên. Bật lại nhân sự thì tài khoản vẫn tắt.
- Đúng một đơn vị chính, kể cả khi race.
- Head phải là thành viên của đơn vị; không kết thúc được membership của head (BA-N-05).
- Manager phải active, không tự quản lý, không tạo vòng.
- Không ngừng được nhân sự còn là head hoặc manager (BA-N-06); ngừng nhân sự giữ membership và mất mọi quyền hiệu lực (BA-N-07).
- ADMIN không tự sửa membership, kho của mình trên mọi API (BA-N-11).
- User Create tạo được tài khoản khởi tạo trong cùng transaction; User List, Org Tree, Chức danh đúng §9.
- Không tạo được vòng lặp cây.
- Chặn ngừng đơn vị hoặc chức danh còn phụ thuộc.
- Membership kết thúc vẫn còn trong lịch sử.
- Đổi Organization không đổi grant.
- `/me` chỉ sửa được email, SĐT.
- Màn User và tab Nhân sự của đơn vị cho cùng kết quả.

**OA3**

- Không có VIEW + scope thì không đọc được, kể cả với người tạo, người phụ trách, người được giao.
- Permission có scope mà thiếu cấu hình scope thì bị từ chối, và UI cảnh báo.
- Scope ngoài danh sách hỗ trợ bị từ chối.
- Hợp scope đúng; không trộn chéo permission.
- List, Detail, Notes, History, File thống nhất trên ma trận test.
- Chứng từ có đơn vị NULL không khớp O/T. Chuyển đơn vị không đổi chứng từ cũ.
- Lưu Role thiếu scope cho permission có scope bị chặn (BA-N-03).
- `owner_org_unit_id` HĐ/PR: mặc định đơn vị chính, chọn đơn vị đang tham gia, từ chối đơn vị không tham gia, NULL khi không có membership (F-OA0-05, BA-N-08). ORG_UNIT và ORG_UNIT_TREE nghiệm thu đầy đủ, gồm nhiều membership và cây nhiều cấp.
- CREATE đánh giá trên trạng thái dự kiến và kiểm lại trong transaction (F-OA0-03).
- Ma trận khởi tạo đã được BA duyệt trước khi áp dụng (BA-N-13).
- Snapshot chỉ khác ở loại "đã duyệt".

**OA4**

- Có permission mà không thuộc nhóm thì không phải ứng viên.
- Nhân sự không có tài khoản không phải ứng viên.
- Ứng viên được loại trùng.
- Ứng viên trên chứng từ cần đủ quyền đọc và quyền xử lý đúng loại chứng từ, đánh giá trên trạng thái dự kiến sau phân công; ứng viên hợp lệ chỉ nhờ ASSIGNED/RESPONSIBLE vẫn chọn được; quyền thực tế chỉ có sau commit (F-OA0-02); lý do loại hiển thị đúng.
- Scope áp đúng đối tượng cho Sales/PM phụ trách (BA-N-01).
- Endpoint pool cũ đã gỡ (BA-N-12).
- Mất quyền thì phân công giữ nguyên nhưng action bị chặn.
- Mọi test PR workflow và Reassign pass.

**OA5, OA6, OA7**

- Mỗi màn hình đúng §9, có UI-EVIDENCE.
- UAT pass; dọn Dev có biên bản.

## 12. Test plan

| Nhóm | Nội dung |
|---|---|
| **Security** | 403 cho từng `/admin/*` với Role thường; không gán được `admin_only`; tự thay đổi; last admin đồng thời; session (logout một phiên, revoke toàn bộ, kích hoạt lại); lockout và unlock; không lộ hash; `must_change_password`; nâng quyền qua Organization, Scope, Kho, Pool |
| **Migration** | Preflight username, `employee_code`; snapshot phân loại §8.3; seed idempotent; `down()` trên Test DB; dry-run dọn dữ liệu |
| **Authorization matrix** | Bảng endpoint × user mẫu × scope cho HĐ, PR: List, Detail, Notes, History, File, picker. Người tạo, người phụ trách, người được giao thiếu VIEW thì bị từ chối |
| **Regression** | Toàn bộ suite API (procurement, pr-scope, pr-workflow, inbound, outbound, inventory, sales-contracts, dossier) và Vitest. Test cũ dựa vào đọc ngầm được **cập nhật có chủ đích**, mỗi thay đổi ghi lý do BA-AUTH-03 |
| **Integration** | Đổi Role hoặc scope có hiệu lực từ request kế tiếp; ngừng Role giữa action PR (`lockGrant`); membership và cây đồng thời; 409 version |
| **Kiến trúc** | Không JOIN grant ngoài Authorization; module nghiệp vụ không đọc Organization để kiểm quyền ngoài `AuthorizationService`; mỗi scope trong `supported_scopes` có cột khai báo |
| **UI/UAT** | Chromium: mọi màn §9. Kịch bản: nhân sự không tài khoản → tạo tài khoản → bắt đổi mật khẩu; sai 5 lần → khóa → ADMIN mở; Role có scope → list HĐ/PR đúng; cảnh báo thiếu scope; nhóm ứng viên Role + User và lý do loại; chuyển đơn vị → chứng từ cũ giữ đơn vị |

## 13. Common tái sử dụng

| Nhu cầu | Có sẵn [HT] | Bổ sung [ĐX] |
|---|---|---|
| List | `ListPageLayout`, `FilterToolbar`, `DataTable` | – |
| Chức danh | `CatalogPage`, `CatalogEditor`, `FormDialog` | – |
| Full Page | `DetailPageLayout`, tabs, Dirty Guard | – |
| Cây | MUI `List`/`Collapse` | `OrgTree` trong feature (không dependency mới) |
| Picker | Pattern product picker | `UserPicker`, `RolePicker`, `OrgUnitPicker`, `JobTitlePicker`, `WarehousePicker` |
| Thao tác | `ActionButton`, `ActionResultDialog` | Mã lỗi §9 |
| Lịch sử | Common Activity History | Target §4.6 |
| Backend | `workflow.ts`, `pr-eligibility.ts`, document-records | `AuthorizationService` thay JOIN rải rác |

## 14. Câu hỏi đã đóng và việc chuyển phase

Q-01…Q-16 và N-01…N-15 đã đóng (§2.11, §2.12). Không còn câu hỏi mở ở OA0. Các việc kiểm chứng kỹ thuật chuyển sang phase:

| Việc | Phase |
|---|---|
| Kiểm chứng SQL, `v_user_grants`, `lockGrant`, admin-guard, session locking trên PostgreSQL (BA-N-04) | OA1 |
| Concurrency account security (F-OA0-04) | OA1 |
| BA duyệt ma trận quyền khởi tạo (BA-N-13) | Trước OA3 |
| Kiểm tra đối tượng áp dụng scope của Sales/PM phụ trách (BA-N-01) | OA4 |
| Gỡ endpoint pool cũ (BA-N-12) | OA4 |
| Script dọn Activity History Dev/Test (BA-N-14) | Khi dọn dữ liệu, có duyệt |
| Scope và đơn vị cho PO, kho; bỏ đọc ngầm kho; `SN_HISTORY.VIEW` | Phase nghiệp vụ tương ứng |

## 15. Handover sau OA2.4 (cập nhật OA3.2)

- **Trạng thái:** OA0, OA1.1, OA1.2, OA1.3 hoàn thành và đã được BA nghiệm thu (OA1.3 gồm closure patch F-OA1.3-15…21). Branch `feat/organization-authorization`, chưa merge. OA1 hoàn thành, không có OA1.4. OA2 làm theo đợt OA2.1–OA2.4 (§11); OA2.1 Job Title hoàn thành và đã được BA nghiệm thu. OA2.2 Organization hoàn thành và đã được BA nghiệm thu (gồm Closure Patch F01–F08). OA2.3 chia OA2.3a–c; OA2.3a (backend User, Employee, Account) hoàn thành và đã được BA nghiệm thu (gồm Closure Review F01–F04). OA2.3b (membership, Role, Warehouse, atomic save, Closure Patch F01–F05) hoàn thành và đã được BA/Architect nghiệm thu. OA2.3c (UI Người dùng + tích hợp Cơ cấu tổ chức) hoàn thành, BA đã duyệt Closure Patch F01–F12 (§11.0 "OA2.3c"). OA2.4 Personal Profile & Integration hoàn thành (gồm Closure Patch F01–F05). **OA2 hoàn thành, BA đã nghiệm thu toàn bộ** (§11.0 "OA2.4"). PR #20 đã merge (`a476e0c`). OA3 trên branch `feat/data-scope`: OA3.0 BA đã duyệt (§2.14, §7.1); OA3.1 Schema & Role API hoàn thành, BA đã nghiệm thu (F01–F04 đóng; technical debt ADMIN invariant đã đóng bằng `sync_system_role_scopes`). OA3.2 Scope Engine & Locking hoàn thành, BA đã nghiệm thu (F01–F03 đóng) (§11.0 "Chi tiết OA3.2": contract engine, lock graph, rà soát F01–F03, transaction boundary, acceptance OA3.3, phần chưa làm). Carryover OA3.3–OA3.5 ở §11.0 "Chi tiết OA3.1". Đợt sau: OA3.3 (Codex có thể tiếp quản: đọc §5.3, §7.1, §11.0 "Chi tiết OA3.1" và "Chi tiết OA3.2"). Không merge riêng OA3.1–OA3.2: `OA3_DEFERRED` và việc gỡ đọc ngầm PR phải đi cùng OA3.3.
- **Đọc trước khi làm tiếp:** §2 (quyết định BA), §11.0 (trạng thái và chi tiết từng phase, gồm lock graph và quy tắc bắt buộc OA2–OA4), [FRONTEND.md](FRONTEND.md) COMMON-UI-CHECKLIST-001, [ADR-0018](decisions/ADR-0018-organization-authorization.md).
- **Acceptance bắt buộc OA2.3 từ OA2.1:** chặn ngừng chức danh đang được nhân sự ACTIVE dùng (`JOB_TITLE_IN_USE`), ghi membership khóa `job_titles` `FOR SHARE`, test đồng thời ngừng chức danh và gán chức danh.
- **Acceptance bắt buộc OA2.3 từ OA2.2:** xem "Chi tiết OA2.2" (§11.0): `ORG_UNIT_IN_USE`, head chỉ từ thành viên, chặn kết thúc membership của head, membership lấy `org-tree`, số nhân sự và tab Nhân sự, kèm test đồng thời; tuân thủ lock graph OA2.2 (admin-guard → `grants` → `users` → `roles` → `org-tree` → `org_units` → `job_titles` → `org_memberships`; không xin lại gate/`users`/`roles` sau `org-tree`).
- **Screenshot OA2.2:** `docs/screenshots/oa2.2/` (quy định trong AGENTS.md). `01-tree-detail.png`, `02-add-child-dialog.png` chụp sau Closure Patch (1366×768); `03-edit-dialog.png`, `04-move-parent-confirm.png` là ảnh **trước Closure Patch** (1440×860, còn nhãn phase cũ trong helper text).
- **Screenshot OA2.3c:** `docs/screenshots/oa2.3c/` (1366×768, Test DB): 01 list, 02–03 View, 04 Membership Dialog, 05 Role Picker, 06 Phạm vi dữ liệu, 07–08 confirm/kết quả lưu, 09 mở khóa, 10 ngừng nhân sự, 11 lịch sử, 12 Create + validation, 13 cây có số nhân sự, 14 tab Nhân sự, 15/17 thêm nhân sự qua Membership API, 16 chọn trưởng đơn vị.
- **Screenshot Closure Patch OA2.3c:** `docs/screenshots/oa2.3c/closure-patch/` (1366×768): 01 toolbar/cột List, 02 khối Tài khoản + thuật ngữ, 03 tab Tổ chức (link, check), 04 chuyển đơn vị chính, 05 Phạm vi dữ liệu, 06 lịch sử (username, giây, Hệ thống), 07 Create + hiện mật khẩu, 08 cây + tab Nhân sự, 09 sửa phân công tại Organization. Ảnh 01–17 ở thư mục cha chụp trước Closure Patch.
- **Seed demo:** cấu hình nhóm ứng viên PR SALES/RECEIPT trước `pnpm seed:demo` (F12).
- **Screenshot OA2.4:** `docs/screenshots/oa2.4/` (1366×768, Test DB): 01 menu tài khoản, 02 Hồ sơ cá nhân, 03 validation email, 04 lưu thành công, 05 Đổi mật khẩu (OA1.2), 06 tooltip mã NV bị cắt.
- **Screenshot Closure Patch OA2.4:** `docs/screenshots/oa2.4/closure-patch/` (1366×768): 01 tab Thông tin chung (Lưu disabled khi chưa đổi), 02 tab Tổ chức (Trưởng đơn vị), 03 tab Vai trò, 04 Dirty Guard, 05 kết quả lưu.
- **Technical debt còn mở sau OA2:** (1) `LOGIN_FAILED`/`ACCOUNT_LOCKED` ghi actor là tài khoản bị thử, cần tách người thực hiện thực tế; (2) kho được cấp trên Hồ sơ cá nhân xem xét tại OA3; empty state Hợp đồng bán theo quyền CREATE tại OA6; (3) UI debt padding TextField multiline (từ OA2.2).
- **Acceptance bắt buộc chuyển sang OA2:** ghi lịch sử phía User khi thêm/gỡ Role (từ màn Role và màn Người dùng) và tăng `roles.version` của Role bị đổi thành viên (OA2.3b); hồ sơ cá nhân sửa email/SĐT (OA2.4). Đã xong ở OA2.3a: username không phân biệt hoa thường (preflight trùng), `EMPLOYMENT_INACTIVE`.
- **Acceptance OA2.3b:** xem "Chi tiết OA2.3" (§11.0): mục (1)–(6), Closure Review (7)–(13) gồm F01, và "OA2.3b đã hiện thực" (contract, lock graph, sai khác). OA2.3c: màn Người dùng List/Full Page (lưu tập trung `memberships[]`, `roleIds[]`, `warehouseIds[]`), tab Nhân sự của đơn vị dùng `GET …/members` và Membership API (thêm/sửa/kết thúc, gửi `version`), số nhân sự trên cây (`memberCount`), chọn trưởng đơn vị (`headUserId`, chỉ thành viên ACTIVE), hiển thị lỗi F01 khi kích hoạt lại và `WAREHOUSE_INACTIVE`, picker kho chỉ cho chọn kho ACTIVE nhưng vẫn hiện kho đã cấp; frontend gọi `account-status`/`reset-password`/`unlock` gửi `version`; UI evidence.
- **Vận hành OA2.3a:** nâng cấp DB có user phải khai `EMPLOYEE_CODES` cho mọi user (`.env.example`), thiếu thì migration dừng.
- **UI debt (BA ghi nhận, xử lý sau tại Common UI):** padding nội dung TextField multiline (ví dụ Mô tả) chưa đồng nhất với input một dòng.
- **Kiểm thử:** API `pnpm --filter api test` (PostgreSQL `mini_erp_test`, cần `pnpm db:up`), Web `pnpm --filter web test`. Browser test dùng API/web tạm trên DB test (cổng 3199/5199), không dùng Dev DB.
