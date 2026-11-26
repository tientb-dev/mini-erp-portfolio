# Bàn giao baseline PR #19

## Trạng thái và phạm vi

BA duyệt đóng baseline kỹ thuật từ `feat/pr-business-completion`. Checkpoint implementation là `192ef1c`. Master Data đã được BA retest OK. Common UI và Common Document đã hoàn tất baseline kỹ thuật. PR đã có backend, frontend và workflow đến Hoàn tất. Business UAT PR vẫn mở. HĐ bán có thiết kế mới và implementation hiện hành vẫn là legacy. PO/Kho có tương thích kỹ thuật, phần hoàn thiện nghiệp vụ thuộc các phase sau.

| Phase | Kết quả |
|---|---|
| 1 và 1.1 | Master Data, mô tả, trạng thái, Hãng–NCC, Common Grid và kết quả thao tác |
| 2 | PR backend, scope theo HĐ, Decimal/ROUND_HALF_UP, snapshot tiền tệ và mapping |
| 3–3.2 | PR frontend, picker, grid sửa dòng, workflow và Common UI |
| 4.1–4.3 | Common Dossier, tích hợp PR, lưu hồ sơ trên PR hoàn tất, tương thích các chứng từ liên quan |
| 5.1–5.2.2 | Technical review, UAT runbook và polish F01–F14 |
| 5.2.3A | Đánh giá HĐ bán và cập nhật thiết kế theo BA. Phase 5.2.3B thuộc bàn giao. |

## Kiểm chứng và điểm còn mở

- Kiểm tra đóng baseline đạt 138/138 API (11 suite, PostgreSQL test), 101/101 Web (13 file), build API/Web và diff check. Upgrade thử từ 16 migration của main lên 23, guard hãng chặn đúng trước khi bổ sung hãng fixture, giữ Product và chạy lại áp dụng 0 migration. Dev được đọc xác nhận có 23 migration.
- Smoke Chromium trên API và PostgreSQL test kiểm Master Data, Supplier/Product Picker, grid hàng hóa PR, lưu và tải lại hồ sơ trên PR Hoàn tất. Web build còn cảnh báo kích thước bundle. Kiểm thử kỹ thuật độc lập với BA retest.
- Kết quả và giới hạn của kiểm tra kỹ thuật trước đây có trong [Phase 5.1](pr19-final-technical-review.md). Xem [ảnh Phase 5.2.2](../screenshots/pr-19/phase-5.2.2/) cho UI Common đã kiểm trên Chromium.
- BA đã xác nhận Master Data. F14 cần BA retest trên PR. Chuyển cột Ghi chú xuống sau File đính kèm còn chờ triển khai. F15–F20 chờ HĐ bán mới. Theo dõi kết quả người dùng trong [Business UAT](pr19-business-uat.md).
- PR mã tạm chưa lập PO theo baseline kỹ thuật. Kiểm lại downstream khi sửa HĐ vì dữ liệu nguồn xuất/nhập, quota và provenance kho còn dựa vào liên kết legacy. Các guard migration có thể dừng khi dữ liệu cũ chưa được xử lý.

## Kiến trúc và điểm vào

- Đọc [Flows](../02-BUSINESS-FLOWS.md), [Rules](../03-BUSINESS-RULES.md), [Permissions](../04-PERMISSIONS.md), [Acceptance Tests](../05-ACCEPTANCE-TESTS.md), [Architecture](../architecture/ARCHITECTURE.md), [Frontend](../architecture/FRONTEND.md) và [Open Questions](../architecture/OPEN-QUESTIONS.md). ADR-0009 ghi hành vi HĐ legacy. ADR-0014/0015 mô tả scope/workflow PR. ADR-0017 chốt mapping, Master Data và tính tiền.
- Dùng `DetailPageLayout`, `DetailTabs`, `DocumentFormGrid`, `FormDialog`, Dirty Guard và `ActionButton`/`ActionResultDialog`. Tái sử dụng `ListPageLayout`, `FilterToolbar`, `DataTable`, `ScrollTable`, `GridText` và `ProductPicker`. Tham khảo `PrPageEditor` cho state qua tab và kết quả lưu.
- Module sở hữu chứng từ kiểm existence, permission, scope và trạng thái. Giao tiếp qua facade. Tham khảo `document-records` cho Notes/Activity History, `document-dossier` cho staging, upload/download, cleanup và `FileAttachmentCell` cho UI. Code PR dùng transaction cho lưu, workflow và hồ sơ. Xem [roadmap hồ sơ](../architecture/DOCUMENT-DOSSIER-ORGANIZATION-ROADMAP.md).

## HĐ bán và thứ tự công việc

1. Đọc [assessment Phase 5.2.3A](pr19-phase-5.2.3a-sales-contract-assessment.md). HĐ ghi snapshot nhu cầu thực tế, có Full Page, grid nhập inline, một file tùy chọn, ghi chú và lịch sử. Picker chỉ điền nhanh. HĐ không ghi loại nguồn hoặc FK catalog. PR xác định mã nội bộ và mapping theo ID dòng HĐ. HĐ chốt khóa dữ liệu, Hủy từ Draft có lý do.
2. Chốt với BA việc tách quyền Tạo/Sửa/Chốt/Hủy và Data Scope. Đối chiếu mô hình PR. Permission độc lập với scope. Organization không cấp quyền. Backend áp cả permission, scope và trạng thái.
3. Kiểm kê dependency của `sales_contract_line_products`, hai FK dòng HĐ, API/cột/permission đề xuất và xác nhận. Rà `SalesContractFacade`, `GirService.unapprovedProducts`, `lockActiveLines`, kiểm tra Product đã dùng, seed, PR mapping và FK nguồn kho. BA cho phép bỏ schema legacy sau khi xác định caller và phương án migration. Bảo toàn ID dòng, liên kết nguồn và dữ liệu cần dùng. PM đối chiếu mã kho với mã HĐ tại ĐNXK theo thiết kế downstream.
4. Triển khai HĐ mới theo checkpoint được duyệt, xác nhận F15–F20, hoàn thiện liên kết HĐ → PR rồi tiếp tục Business UAT PR. Theo dõi F14 và đổi thứ tự cột Hồ sơ. PO/Kho/ĐNXK triển khai theo phase riêng.

## Chạy local, migration và lưu trữ

- Theo [README](../../README.md) và `.env.example`. Cài bằng `pnpm install --frozen-lockfile`, khởi động PostgreSQL bằng `pnpm db:up`, API bằng `pnpm dev:api` tại localhost:3100 và Web bằng `pnpm dev:web` tại localhost:5180. Dùng cấu hình Dev hiện có để bảo toàn UAT và tài khoản. Seed cho DB mới hoặc khi được phép đồng bộ quyền.
- Dev dự kiến là `mini_erp` cổng 5442 với 23 migration, cuối `1733356800000`. Kiểm tra đích và `pnpm --filter api typeorm migration:show` trước khi ghi. Với DB có dữ liệu, backup trước rồi chạy `pnpm --filter api migration:run --transaction each`. Xử lý guard hãng theo [runbook migration](pr19-product-brand-upgrade.md). Migration hồ sơ không backfill PR cũ.
- Integration tests có thao tác reset schema. Trỏ `TEST_DATABASE_URL` rõ ràng vào PostgreSQL test đã xác minh. Local từng dùng container test độc lập cổng 5551, database `mini_erp_test`. Chạy `pnpm --filter api test`, `pnpm --filter web test`, `pnpm build` và browser smoke qua API/DB test với storage riêng.
- Cấu hình `DOSSIER_STORAGE_DIR` bền vững và có quyền phù hợp với API. Sao lưu bằng `pg_dump -Fc` và lưu snapshot thư mục blob ở cùng mốc khi dừng ghi. Thử `pg_restore` vào database cô lập cùng bản sao storage, đối soát migration, metadata, lịch sử và tải file. Với lỗi migration, giữ backup và xử lý nguyên nhân guard. Khi có dữ liệu mới, đánh giá tác động trước khi chạy down.
