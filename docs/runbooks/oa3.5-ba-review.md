# OA3.5 Final Closure · Báo cáo BA

## Phạm vi và thay đổi

Nhánh `feat/data-scope`, HEAD `f17340a`. BA chọn Clean Reset Dev/Test và dựng dữ liệu nền theo kiến trúc đích. BA đã nghiệm thu Final Closure và toàn bộ OA3. Báo cáo ghi nhận kết quả tại checkpoint Final Closure.

| Thành phần | Kết quả |
|---|---|
| Chuyển grant cũ | Bỏ `planGrantMapping`, CLI dry-run/apply, snapshot/projection và kiểm digest, test riêng của mapping, SQL đối chiếu dữ liệu legacy và hướng dẫn phục hồi dữ liệu nguồn. Ma trận scope dùng cho seed chuyển sang `oa3-default-scopes.ts`. |
| Kiến trúc đích | Giữ migration OA3.1 up/down, catalog, trigger ADMIN, FK/cascade, Role API, audit, Scope Engine fail-closed, lock graph, owner và D04–D07. Giữ kiểm thử còn giá trị với schema đích, rollback, security và concurrency. |
| Seed | Seed ghi trong một transaction dưới gate `grants` exclusive. Chạy lại giữ Role, grant/scope và user đã có. Seed Dev chỉ tạo ADMIN bootstrap và dữ liệu nền. Seed fixture users và demo kiểm tên DB Test trước khi ghi. |
| Tài liệu | AGENTS, CLAUDE, Architecture, §11.0, §15, ADR-0018, 04-PERMISSIONS và runbook theo Clean Reset. 02/03 ghi rõ hủy HĐ DRAFT/ACTIVE theo OA3.3a F01, permission + scope, kiểm PR/GIR và H-01 với DRAFT. Hành vi runtime giữ nguyên. Lý do và lịch sử hủy HĐ chuyển OA6. |

## Đích reset và seed

- Dev `mini_erp`, Test `mini_erp_test` cùng container `mini-erp-portfolio-postgres-1`, PostgreSQL 16.16, Docker Compose publish `127.0.0.1:5442`. Xác minh project, volume `mini-erp-portfolio_pgdata`, owner DB và số session trước khi xóa/tạo lại từng DB. Cả hai có 0 bảng public tại thời điểm tạo lại. Container giữ database ngoài phạm vi và volume chung.
- Kho Dev `.local/dossiers` được xác minh là thư mục thường và đã trống. Test dùng kho mới tách riêng và thư mục tạm chuyên dụng của suite hồ sơ. Storage Dev không nhận file từ fixture. Instance native ở cổng 5432 và DB `mini_erp_e2e` nằm ngoài phạm vi.
- Dev chạy 31 migration, migration cuối `DataScope1734048000000`. Seed có 1 user bootstrap, 7 Role, 53 permission, 107 grant, 32 dòng scope, 1 UoM PCS và 1 kho HCM. Không có PR, HĐ, file hồ sơ, pool ứng viên hoặc lịch sử chứng từ. Fingerprint các bảng user, Role, grant/scope và dữ liệu nền khớp qua reseed. Test riêng thay đổi scope để xác nhận seed giữ cấu hình đã lưu.
- Test chạy fresh migration, down OA3 rồi up lại qua CLI. Down bỏ bảng scope và các cột OA3. Up khôi phục migration cuối và schema đích. Fixture sau đó có tám user và hai PR. Kiểm Dev sau smoke vẫn có một user, bảy Role và 0 HĐ, PR, pool hoặc file hồ sơ.

## Ma trận quyền thực tế trên Dev

A = ALL, C = CREATOR, R = RESPONSIBLE, G = ASSIGNED, O = ORG_UNIT, T = ORG_UNIT_TREE. Dấu — là Role không có grant tương ứng.

| Role | Tổng grant | HĐ VIEW | HĐ CREATE | PR VIEW | PR CREATE | PR APPROVE | PR RECEIVE | PR REASSIGN | PR DOSSIER_MANAGE |
|---|---:|---|---|---|---|---|---|---|---|
| ADMIN | 53 | A | A | A | C R O T | A | A | A | A |
| SALES | 11 | C R | C R | C R G | C R | — | — | — | — |
| PM | 9 | R | — | C R G | C R | — | — | — | — |
| PURCHASING | 9 | — | — | A | — | — | G | — | — |
| SALES_HEAD | 4 | — | — | G | — | G | — | — | — |
| PM_HEAD | 4 | — | — | G | — | G | — | — | — |
| WAREHOUSE_MANAGER | 17 | — | — | — | — | — | — | — | — |

ADMIN có 11 dòng scope canonical. Grant theo kho và quyền unscoped của từng Role nằm trong bản xuất SQL đầy đủ tại `artifacts/evidence/oa3.5-final/dev-matrix.txt`. Scope ALL của Purchasing chỉ dùng cho PR VIEW theo §7.1.

## Kiểm chứng

- API full **299/299**, 22 suite PostgreSQL thật. Hai test chỉ phục vụ mapping được gỡ. Lượt đầu chạy song song với build chạm timeout 5 giây ở bootstrap Outbound. Lượt chính thức chạy API tuần tự với `--testTimeout=20000` đạt.
- Web full **164/164**, 21 suite. API/Web build và `git diff --check` đạt.
- Các suite đích kiểm ADMIN canonical và DB protection, fail-closed từng grant, hợp scope SQL/TS, List/COUNT/Detail, HĐ/PR owner và prospective scope, ASSIGNED lịch sử và thao tác bước hiện tại. Regression cũng kiểm warehouse scope, D04–D07, redaction trên đường đọc nguồn và effective-access.
- Concurrency **59/59 trong cả 3 lượt**, 4 suite mỗi lượt. Các ca kiểm PID của backend và blocker, advisory key/mode, transaction ID và relation của chứng từ. Bao phủ revoke permission/scope, membership, reparent, snapshot, HĐ/PR action và PO source. Không thấy deadlock, lock upgrade hoặc stale authorization trong các ca chạy.
- Chromium **1366×768** qua API thật và Test DB. Sales Head thấy hai PR theo lịch sử phân công. Chi tiết PR đã hoàn tất che HĐ và khách hàng nguồn, ẩn nút duyệt/tiếp nhận. Direct ID HĐ với Sales Head và PR với Warehouse trả 403. Effective-access của ADMIN hiển thị bốn scope canonical của PR.CREATE. [PR hoàn tất](../screenshots/oa3.5/01-pr-hoan-tat-an-nguon.png) · [ADMIN canonical scopes](../screenshots/oa3.5/02-admin-canonical-scopes.png)
- Log và dữ liệu đối chiếu lưu tại `artifacts/evidence/oa3.5-final/`. Quy trình reset, down/up và xử lý lỗi ở [Runbook Clean Reset](oa3-migration-deployment.md).

## Technical debt và quyết định BA

- **Blocker kỹ thuật OA3.5.** Không phát hiện blocker trong phạm vi Clean Reset và ma trận đã nghiệm thu.
- **OA6:** bổ sung lý do và lịch sử hủy HĐ. Endpoint hiện hành chỉ cập nhật trạng thái. Điều kiện hủy đã được nghiệm thu tại OA3.3a F01.
- **Non-blocker OA3.5.** OA4 workflow eligibility, phase kho/PO, sáu mục Admin UX OA5, empty state HĐ OA6, audit actor `LOGIN_FAILED`/`ACCOUNT_LOCKED`, padding multiline Common UI và cảnh báo Vite chunk/SSR.
- **OA7:** timeout bootstrap Outbound khi chạy cùng build và cảnh báo pg driver khi gọi đồng thời trên cùng client. Hai mục được theo dõi như technical debt.
