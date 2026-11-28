# OA3.5 · Runbook Clean Reset Dev/Test

Clean Reset dùng cho Dev/Test trong phạm vi BA phê duyệt. OA3 dùng schema đích, catalog và seed §7.1. Dữ liệu nghiệp vụ, tài khoản thử nghiệm, custom Role, grant và cấu hình cũ được bỏ trong đợt reset được duyệt.

## Xác minh trước khi reset

1. Ghi phạm vi BA phê duyệt, revision, DB và storage. Dùng `docker compose ps` và metadata của container để xác nhận project, service, cổng loopback, volume và mount. Với workspace này, Compose publish `127.0.0.1:5442` vào PostgreSQL container. Xác nhận `current_database()`, owner, `current_setting('data_directory')` và session trên server. Dev là `mini_erp`, Test là `mini_erp_test`.
2. Dừng API/worker/fixtures đang dùng hai DB và xác nhận không còn session. Với kho hồ sơ, giải đúng `DOSSIER_STORAGE_DIR` hoặc mặc định `.local/dossiers`, xác minh đường dẫn tuyệt đối, mount, liên kết và môi trường dùng chung. Storage riêng của Test tách khỏi Dev. Nếu còn file không xác minh được quyền sở hữu, xử lý đích đó trước khi xóa.
3. Chỉ reset database và storage đã xác minh. Với Compose dùng chung volume cho nhiều database, xóa/tạo lại từng database đã duyệt, giữ volume và DB khác. Xác minh database sạch và storage sạch. Nếu kho đã trống, ghi nhận kiểm chứng và giữ thư mục.

## Migration và seed

Tại Dev, trỏ `DATABASE_URL` đến Dev đã xác minh hoặc dùng cấu hình Dev đã duyệt. Chạy `pnpm migrate` rồi `pnpm seed`. Đối chiếu catalog, ADMIN canonical scopes và ma trận §7.1. Kiểm Dev chỉ có bootstrap ADMIN, Role mặc định, PCS và HCM. Seed chạy trong một transaction, dùng gate grants exclusive và giữ nguyên Role/user đã có kể cả khi cấu hình khác seed.

Tại Test, trỏ `DATABASE_URL` và `TEST_DATABASE_URL` đến Test đã xác minh. Chạy fresh migration, kiểm down/up OA3 trên schema Test biệt lập, rồi seed và regression PostgreSQL. Các suite reset schema ở bootstrap. Giữ riêng storage Test khi chạy API.

Browser smoke chạy sau regression. Nếu cần dựng lại fixture, khởi tạo Test sạch và chạy `pnpm --filter api seed --fixture-users` với `DATABASE_URL` là Test. Áp cấu hình pool thử nghiệm có eligibility hợp lệ. `pnpm seed:demo` chỉ chạy trên `mini_erp_test`. Dùng API/Web cổng riêng, storage riêng và viewport 1366×768. Ghi evidence vào `docs/screenshots/<phase>/`.

## Rollback và kiểm sau reset

- Migration OA3 có down/up. Kiểm trên Test rằng down gỡ scope schema, hai cột owner và khôi phục trigger cấp grant. Up tái lập ADMIN canonical scopes. Down schema xóa cấu hình scope và owner phát sinh sau OA3, nên dành cho rehearsal trên Test.
- Với lỗi seed, transaction rollback. Với lỗi của một migration, kiểm bảng `migrations` và transaction trước khi chạy lại. Trong đợt Clean Reset đã duyệt, sửa lỗi và dựng lại đích tương ứng từ schema sạch. Dữ liệu thử nghiệm trước reset nằm ngoài phạm vi phục hồi.
- Đối chiếu grant, user, kho, tài liệu, audit và kết quả API trước khi mở ứng dụng. Giữ Dev chỉ có dữ liệu nền. Xác minh Dev lại sau khi kết thúc Test.
