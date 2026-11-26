# PR #19 · Phase 5.1 · Final Technical Review

Phạm vi review từ merge-base và HEAD của `main` `0cdbb075e5b375e0fa8ecf834ad3ded768b3871d` đến baseline `8c0dccb` trên `feat/pr-business-completion`, cộng bản sửa của Phase 5.1. Diff baseline gồm 187 file, trong đó có ảnh nghiệm thu. Đối chiếu AGENTS, CLAUDE, README, tài liệu 01–05, Architecture, Frontend, ADR 0005/0008/0009/0012/0014/0015/0016/0017 và runbook nâng cấp hãng.

## Kết quả A–G

| Nhóm | Kết quả |
|---|---|
| A · Quy tắc | Đạt theo bảng bên dưới sau khi sửa việc đổi mã tiền tệ ngoài ý muốn. |
| B · Dữ liệu và backend | FK và constraint bảo vệ định danh nguồn và file hiện hành. Ghi PR và hồ sơ trong transaction, kiểm tra phiên bản và khóa theo chứng từ. Gửi lại Create dùng request key và fingerprint. Picker và PR List web phân trang server. API danh sách PR vẫn giữ chế độ mảng cho caller cũ. |
| C · Quyền và dữ liệu nhạy cảm | Đối chiếu guard, kiểm tra phạm vi và trạng thái trong Procurement, Master Data và Dossier. Suite có ca ngoài phạm vi, thu hồi quyền, file tạm sai người dùng hoặc phiên, ID sai và truy cập chéo PR. File dùng đường dẫn riêng và khóa lưu trữ UUID. Rà tên file và diff văn bản từ merge-base, không thấy secret, tài liệu upload hoặc dump được thêm. Ảnh kiểm thử là PNG trong thư mục evidence. |
| D · Frontend | Đối chiếu List, Search, Document Page/Grid, Product Picker, Line Editor, DocumentTotals, ActionButton, các dialog, FileAttachmentCell, Dirty Guard, Stepper và bản dịch vi/en. Kiểm tra kiến trúc frontend và smoke theo rủi ro. Mã tiền tệ của lựa chọn đang lưu lấy từ snapshot khi chỉnh tỷ giá. |
| E · Liên thông | Suite HĐ bán, PO, GRR/GR, GIR/GI và tồn kho đạt. PR hoàn tất có cả mã chính và mã tạm vẫn cung cấp dòng mã chính cho PO. Mã tạm bị từ chối tại ranh giới tạo PO. Đường nhập/xuất giữ ID dòng nguồn và sử dụng Product thật. |
| F · Migration | Sáu migration PR #19 nối sau 16 migration main. DB mới của suite lên đủ 22. Trong DB nâng cấp riêng, guard dừng sau migration thứ 17 khi Product thiếu hãng. Sau khi gán hãng thật của fixture, 5 migration còn lại chạy thành công, Product giữ nguyên ID và chạy lại không có migration mới. |
| G · Tài liệu | ADR-0017 giữ quyết định nghiệp vụ, runbook Hãng giữ trình tự thao tác và Architecture/Roadmap giữ điều kiện kho file. Bảng này ghi kết quả review và các điểm còn lại. README tiếp tục dùng quy trình migrate/seed hiện hành. |

## Business Rules Compliance Matrix

| Quy tắc | Implementation | Evidence và kết quả |
|---|---|---|
| DEC-19-01 · Trùng mã | PR và HĐ lưu theo ID dòng, cảnh báo mềm từ grid. GRR kiểm tra trùng ID dòng PO. | `procurement.int.spec.ts` mixed lines, `sales-contract-lines.int.spec.ts`, `inbound.int.spec.ts` duplicate PO sources. Đạt. |
| SC-LINE-INPUT-001 · Ba nguồn dòng HĐ | SalesContracts kiểm tra nguồn chính/tạm/tự do, chụp thông tin dòng và giữ mô tả; migration giữ FK rỗng cho dòng cũ. | `sales-contract-lines.int.spec.ts` ba nguồn, nguồn inactive và dữ liệu dòng cũ. Đạt. |
| DEC-19-02 · Mapping nhu cầu | Procurement khóa và kiểm tra dòng cùng HĐ ACTIVE. Hàng bán cần mapping khi gửi duyệt, Vật tư có thể để trống. Gợi ý theo một ứng viên cùng ID và loại mã trong PR editor. | `procurement.int.spec.ts` validation boundaries và mixed lines, suite procurement frontend. Đạt. |
| DEC-19-03 · Mã tạm | PR lưu snapshot mã tạm; PO chỉ nhận dòng mã chính có nguồn hợp lệ. Nhập/xuất kế thừa nguồn và dùng Product thật. | `procurement.int.spec.ts` mixed sources, `inbound.int.spec.ts`, `outbound.int.spec.ts`. Đạt theo phạm vi PR #19. |
| DEC-19-04 · Dữ liệu lịch sử | Migration tạo hãng nullable, sau đó guard yêu cầu hãng xác minh. Migrate không xóa chứng từ hay backfill nguồn hàng. | Chạy thực tế từ schema main, guard và bước gán hãng đều được kiểm chứng. Đạt. |
| DEC-19-05 · Tiền tệ và giá tối đa | PR lưu một tiền tệ, nguồn tỷ giá, thuế và đơn giá trước thuế. VND bằng 1. Nháp chấp nhận giá 0; Gửi duyệt yêu cầu giá dương. | `procurement.int.spec.ts` refresh, inactive snapshots và validate draft/submit. Đạt sau sửa snapshot. Kiểm soát hạn mức trên PO thuộc backlog. |
| DEC-19-06 · Common Dossier | Dossier dùng registry chung; Procurement sở hữu quyền và transaction. | `dossier.int.spec.ts`, `pr-dossier.int.spec.ts`. Đạt theo bảng DOSSIER. |
| DEC-19-07 · Decimal | PostgreSQL `numeric` làm tròn thành tiền trước rồi tính thuế. UI preview dùng số nguyên BigInt và phân biệt 0/null. | `procurement.int.spec.ts` HALF_UP và precision, `document-money.test.ts`, `document-inputs.test.tsx`. Đạt. |
| DEC-19-08 · HĐ và dòng bắt buộc | Create/Edit kiểm tra HĐ ACTIVE, quyền theo HĐ và ít nhất một dòng hợp lệ. Gửi duyệt kiểm tra thêm header, dòng và người xử lý. | `procurement.int.spec.ts` draft/submit, `pr-scope.int.spec.ts`. Đạt. |
| Workflow hai bước | Khóa PR và kiểm tra version/round/step, ghi lịch sử và notification cùng transaction. | `procurement.int.spec.ts` approve, receive, recall, reject, resubmit và reassign; Chromium xác minh PR hoàn tất qua workflow thật. Đạt. |

| Quy tắc hồ sơ | Implementation và evidence |
|---|---|
| DOSSIER-001 | Registry Common Document Records và Procurement kiểm tra đích. Test API phạm vi và quyền. Đạt. |
| DOSSIER-002 | Mã loại duy nhất, cấu hình có thứ tự và version. Test đổi thứ tự, inactive, rollback. Đạt. |
| DOSSIER-003 | Giấy và điện tử độc lập. Test bốn tổ hợp, uncheck giữ thông tin. Đạt. |
| DOSSIER-004 | Chỉ một liên kết hiện hành, lưu file cũ và lịch sử. Test thay thế, xóa, cleanup và tải sau restart. Đạt. |
| DOSSIER-005 | Workflow xác thực PR, không yêu cầu hồ sơ. Test toàn bộ luồng trên PostgreSQL và Chromium. Đạt. |
| DOSSIER-006 | Quyền đọc/tải theo PR; quản lý yêu cầu quyền riêng và PR chưa hủy. Test ID chéo, thu hồi quyền, lưu trong View đồng thời với duyệt. Đạt. |
| DOSSIER-007 | Hồ sơ và attachment tách riêng, schema cho phép nhiều attachment cùng file bất biến. Kế thừa PR → PO chủ động hoãn. |
| DOSSIER-008 | Snapshot lần lưu đầu, kể cả rỗng. PR cũ giữ trống. Revision chống đổi cấu hình giữa phiên. Test snapshot legacy, bất biến và `409`. Đạt. |
| DOSSIER-009 | Create/Edit lưu trong transaction; View có version hồ sơ riêng và lịch sử trước/sau. Test rollback, concurrent update, no-op, Dirty Guard. Đạt. |

## Findings

| Mức và loại | Vị trí, nguyên nhân và tái hiện | Rule, xử lý và evidence |
|---|---|---|
| **Medium · Lỗi đã sửa** | `apps/api/src/modules/procurement/pr-commercial.ts:50` ghi lại `currency_code` khi chỉ làm mới tỷ giá của cùng currency ID. `apps/web/src/features/procurement/PrPageEditor.tsx:98` có thể ưu tiên mã Master Data khi thay đổi điều khiển tỷ giá. Tạo PR EUR, sửa mã danh mục thành GBP, rồi làm mới tỷ giá. | DEC-19-05/07. Giữ mã và precision snapshot khi cùng currency ID. Chỉ cập nhật tỷ giá theo thao tác rõ ràng. Regression ở `apps/api/src/procurement.int.spec.ts:104`. Chromium và API tái hiện GBP ở baseline và xác nhận giữ AUD sau khi danh mục đổi thành CAD trên bản sửa. |
| **Medium · Rủi ro tải** | `apps/api/src/modules/procurement/procurement.service.ts:596` bỏ LIMIT nếu caller không gửi `page`. Đây là đường tương thích sẵn có. Khi số PR tăng, phản hồi và phép tính tổng trên tập kết quả cũng tăng. | Common List Processing. Suite xác nhận shape tương thích cho caller cũ và paginated response cho web. Đo tải với dữ liệu lớn rồi lập kế hoạch chuyển caller cũ sang phân trang trước khi bỏ đường tương thích. Chưa đo tải ở quy mô production. |
| **Low · Technical debt** | Asset JS chính vượt ngưỡng cảnh báo của Vite, khoảng 1,506 kB chưa nén, 452 kB gzip. Tái hiện bằng build frontend. | Ảnh hưởng tải ban đầu. Build thành công; đưa việc đo tải và tách bundle vào backlog, giữ nguyên giao diện đợt này. |

Chưa có finding Critical hoặc High được xác nhận. Business UAT và đo tải production nằm ngoài chứng cứ của lượt này.

## Kiểm chứng cuối

- API trên PostgreSQL thật đạt 136/136 ca trong 11 suite. Frontend đạt 89/89 ca trong 12 suite. Build API, build frontend và `git diff --check` đạt.
- Chromium dùng API và PostgreSQL test. Kiểm tra PR List, Stepper từ workflow thật, Dirty Guard, lưu View, tải file sau restart và route cấu hình. So sánh hai fixture tương đương cho lỗi tiền tệ. [Trước khi sửa, EUR bị đổi thành GBP](../screenshots/pr-19/phase-5.1/before-currency-refresh-1366.png). [Sau khi sửa, AUD được giữ dù danh mục đổi thành CAD](../screenshots/pr-19/phase-5.1/after-currency-refresh-1366.png).
- Dev vẫn có 22 migration với `1733270400000` là migration cuối. DB nâng cấp test `pr19_upgrade_297d15bad9` có 22 migration và giữ Product fixture ID 1.

## Điều kiện triển khai và backlog

- Kiểm tra đích DB, backup PostgreSQL và kho file, thử phục hồi cùng một mốc backup. Chạy migration theo từng transaction và làm theo [runbook Hãng](pr19-product-brand-upgrade.md) nếu guard dừng. Chạy seed theo cấu hình môi trường, xác minh quyền catalog/dossier và gán role sau nâng cấp.
- Thiết lập `DOSSIER_STORAGE_DIR` bền vững, quyền đọc/ghi riêng cho user của API và giới hạn upload. Kiểm tra tải file đã lưu sau restart. Với môi trường đã phát sinh mã tạm hoặc hồ sơ, rollback ưu tiên phục hồi backup theo kế hoạch vì down migration có thể mất metadata hoặc không áp dụng được cho dữ liệu mới.
- Backlog nghiệp vụ gồm kế thừa hồ sơ PR → PO, kiểm soát đơn giá PO theo giá PR đã duyệt, mã tạm trên PO và chuyển sang mã chính khi nhập kho. Backlog nền tảng gồm Organization, Authorization nâng cao, lưu trữ nhiều API host và kích thước bundle Vite.
- DB Dev chỉ được đọc trạng thái. Test migration và fixture dùng PostgreSQL cổng 5551, với DB và kho file riêng.

**Đề xuất Go cho Phase 5.2** nếu BA chấp thuận các rủi ro đã ghi. Đây là quyết định chuyển sang Business UAT. Điều kiện triển khai và nghiệm thu merge được kiểm tra ở bước tương ứng.
