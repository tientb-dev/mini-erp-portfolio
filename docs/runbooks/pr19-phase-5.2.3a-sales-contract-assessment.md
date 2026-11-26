# Phase 5.2.3A · Đánh giá kỹ thuật HĐ bán

## A. Git và trạng thái UAT

Ngày 26/11/2026, HEAD local là `192ef1c` trên `feat/pr-business-completion`, working tree sạch khi bắt đầu. Branch không có upstream cấu hình. `git ls-remote origin refs/heads/feat/pr-business-completion` trả mã 0 và không trả ref. Kiểm tra khi đóng baseline xác nhận GitHub chưa có PR số 19 hay PR từ branch này. Theo bàn giao BA, Master Data đã retest thành công, UAT dừng tại HĐ và F14 vẫn chờ retest trên PR.

## B. Hiện trạng tại HEAD

| Khu vực | Bằng chứng |
| --- | --- |
| Schema | SQL qua TypeORM `EntityManager` trong [SalesContractsService](../../apps/api/src/modules/sales-contracts/sales-contracts.service.ts). Các migration trong [database/migrations](../../apps/api/src/database/migrations) là căn cứ DDL. `1731542400000-InboundChain` tạo `sales_contracts` với serial PK, mã unique, CHECK ba trạng thái, FK customer và user tạo; `sales_contract_lines` có serial PK, FK HĐ, mã 100, tên 300 và `numeric(18,3)` dương. |
| Mở rộng schema | `SalesContractEditing` thêm version/audit, `ResponsibleSales` thêm FK Sales và CHECK ACTIVE có Sales, được validate bởi `InventoryLots`. `PrWorkflow` thêm FK PM. `SalesContractLineUom` thêm FK ĐVT bắt buộc; `PrMasterData` thêm mô tả, hai FK catalog nullable và CHECK tối đa một FK. `OutboundChain` tạo bảng liên kết giao theo FK dòng HĐ/Product và lưu lý do, người đề xuất/quyết định. |
| Ghi HĐ | [Controller](../../apps/api/src/modules/sales-contracts/sales-contracts.controller.ts) có POST/PATCH HĐ, POST dòng, PATCH/DELETE theo ID dòng, POST `activate` và `cancel`. POST nhận dòng tùy chọn, Sales nullable. `create` cấp mã qua `wf.nextDocumentNumber(m, 'SC')` và lưu đầu/dòng trong một transaction; chưa có khóa request. `update` giữ ID qua `updateLine`, chèn dòng mới, xóa dòng bị bỏ qua `wf.deleteOmittedLines`; bỏ trường `lines` thì giữ nguyên. `lockDraft` khóa đầu HĐ `FOR UPDATE`, kiểm version và trả 409 khi stale. |
| Trạng thái | `activate` dùng UPDATE có điều kiện DRAFT, có Sales và có dòng, tăng version; không nhận version từ form. `cancel` khóa đầu HĐ rồi kiểm PR/GIR chưa hủy bằng SQL đọc bảng module khác, hiện cho cả ACTIVE đủ điều kiện; không nhận lý do/version và câu UPDATE chỉ đổi trạng thái. |
| Validation | DTO kiểm mã/tên, độ dài và số lượng dương. Precision lưu do PostgreSQL quyết định, nên cần kiểm tối đa ba số thập phân trước ghi. `lineValues` kiểm nguồn catalog, chụp snapshot và kiểm ĐVT; mã chính ảnh hưởng cờ sử dụng Product. |
| Quyền | Controller dùng `SALES_CONTRACT.VIEW` cho list/get/lines, `SALES_CONTRACT.CREATE` cho tạo/sửa/chốt/hủy và danh sách Sales, quyền riêng PROPOSE_PRODUCT/CONFIRM_PRODUCT. List/get hiện không lọc theo khách hàng/người tạo. Chưa có API notes/history/file HĐ ở controller. |
| UI | [routes.ts](../../apps/web/src/app/routes.ts) và [SalesContractsPage](../../apps/web/src/features/sales-contracts/SalesContractsPage.tsx) mở danh sách/chi tiết; Create và sửa header qua `ScHeaderDialog`. `ScDetailView` mặc định Hàng hóa, có tab PR theo quyền, dùng `ScLineDialog` và `ScDialogs` cho thao tác từng dòng/trạng thái/đề xuất. List đã dùng URL cho search/filter/sort/page, mặc định 25 và ngày tạo giảm dần; API còn trả mảng khi thiếu page cho caller cũ. |

## C. F15–F20

| Finding | Nguyên nhân hoặc chênh lệch tại source | Xử lý dự kiến |
| --- | --- | --- |
| F15 | `ScHeaderDialog.onSuccess` invalidates list/detail rồi gọi `onSaved`. Nhánh Create trong `ScListView` chỉ gọi navigate. [FormDialog](../../apps/web/src/shared/components/FormDialog.tsx) vẫn gắn `RouteDiscardGuard` dựa trên dirty/pending; `useBlocker` chặn navigate vì dữ liệu khác initial và đường thành công chưa có cờ bypass. Parent vẫn giữ creating và nhánh thành công chẳng dựng Action Result. Chuỗi này giải thích list reload sau POST và modal còn mở. | Full page, lock submit đồng bộ và vô hiệu hóa mọi action khi pending. Sau thành công cập nhật baseline/cache rồi cho phép điều hướng chính thức qua guard, hiện Action Result với mã HĐ và vào detail. Request key phía server bảo vệ retry sau mất phản hồi. |
| F16 | `ScLineDialog` gọi `catalogSelectionPath` lấy mảng rồi .filter/.map thành MenuItem; đường này thiếu server paging. [ProductPicker](../../apps/web/src/shared/components/ProductPicker.tsx) đã có server list theo từng tab, debounce, sort, brand và page. | Dùng cùng picker với mode single, giữ multi của PR, benchmark cả mã chính/mã tạm với 100.000+ mặt hàng và kiểm kế hoạch truy vấn. |
| F17 | Radio main/temporary/free và payload hai FK ở `ScLineDialog`, xử lý nguồn ở `lineValues`. | Snapshot tự nhập, chọn danh mục chỉ điền nhanh; PR chọn catalog và map dòng bằng ID. |
| F18 | `ScLineDialog` đặt TextField multiline ngoài [DocumentFormGrid](../../apps/web/src/shared/components/DocumentFormGrid.tsx). [theme.ts](../../apps/web/src/config/theme.ts) áp padding cho root multiline và input; Common Form đã reset padding textarea. Đây là nguyên nhân ở CSS tại source, cần đối chiếu computed style với CatalogEditor và ảnh thật ở B/C. | Dùng quy tắc Common Input/Form tại nơi render, kiểm multiline cả trong grid; chỉ cân nhắc sửa theme nếu chứng minh lỗi chung. |
| F19 | `ScLineDialog` đặt `DuplicateCodeWarning` cạnh TextField trong Stack ngang; icon xuất hiện chiếm chiều rộng. | Tái sử dụng helper tìm dòng trùng, đặt icon amber focusable với tooltip ở vùng end adornment cố định, dành chỗ cho picker và lỗi; cập nhật khi đổi/xóa mã. |
| F20 | `ScLineDialog` gọi POST/PATCH theo dòng, xóa và chuyển trạng thái qua luồng riêng trong detail. | Grid inline và một lần lưu toàn chứng từ. |

## D. Thiết kế đã chốt và thay đổi cần triển khai

- HĐ ghi nhận nhu cầu của hợp đồng đã ký. Mã cấp lần lưu đầu. Tên, khách hàng, Sales và ngày HĐ bắt buộc; ngày mặc định hôm nay khi Create. Số hợp đồng thực tế, ngày giao dự kiến, diễn giải và file tùy chọn. Audit do hệ thống quản lý. Giá, thuế, tiền tệ, điều khoản thanh toán, doanh thu/công nợ và workflow duyệt nằm ngoài phạm vi.
- Full Page Create/Edit/View dùng DetailPageLayout, PageBreadcrumbs, DetailTabs, ActionButton, ActionResultDialog và Dirty Guard. Create chỉ có Thông tin chung/Hàng hóa, mở page không ghi HĐ. Edit/View thêm PR, Ghi chú, Lịch sử, mặc định Thông tin chung và nội dung PR theo quyền. Mã HĐ mở Edit khi có quyền và DRAFT, các trường hợp còn lại mở View.
- Toolbar danh sách hai hàng: Search/Trạng thái/Sales/Khách hàng, rồi khoảng ngày HĐ và Làm mới bên phải. Search theo mã, số, tên HĐ và khách hàng; danh mục lớn tìm server-side. Bảng gồm mã, số thực tế, tên, khách hàng, Sales, ngày HĐ, ngày giao, số dòng, trạng thái và ngày tạo. Làm mới reset về mặc định 25 dòng, ngày tạo giảm dần và refetch. Giữ URL khi quay lại. Bỏ cột thao tác và Chờ xác nhận khỏi list. Bỏ cột Mã hàng được phép giao và toàn bộ thao tác đề xuất/xác nhận trên chi tiết mục tiêu.
- Common Document Form 12 cột theo hàng: số/tên 4/8, khách/Sales 8/4, ngày HĐ/ngày giao 3/3, diễn giải/file 7/5. Hai ô hàng cuối cùng chiều cao mặc định; responsive xuống hàng. Grid có STT, mã, tên, mô tả, số lượng, ĐVT, ghi chú, thao tác; header xuất hiện khi rỗng, Thêm dòng focus mã, sticky header, zebra, scroll và lỗi tại ô. Mã/tên và ĐVT bắt buộc, số lượng dương tối đa ba số lẻ, mô tả/ghi chú tùy chọn, mã trùng cảnh báo mềm.
- State editor giữ snapshot đầu/dòng và file qua tab, dùng ID DB của dòng cũ và client key ổn định cho dòng mới. Picker hiện khi bấm kính lúp, xác nhận trước khi ghi đè dữ liệu đã nhập, điền mã/tên/ĐVT/mô tả có sẵn, giữ số lượng và cho sửa mọi trường. Giữ dirty khi API lỗi; chuyển tab và focus lỗi đầu tiên. Dùng `DocumentFormGrid`, `DataTable`, `ListPageLayout`, `FilterToolbar`, StatusChip và pattern `PrPageEditor`; mở rộng picker/adornment khi có tái sử dụng, giữ logic grid HĐ tại feature.
- Save Draft cho grid rỗng, mọi dòng đã nhập phải hợp lệ. Chốt trực tiếp trên Create/Edit áp cùng validation và cần ít nhất một dòng. Xác nhận khóa dữ liệu trước khi chốt. Hủy chỉ DRAFT, cần lý do, ghi history. Cả ACTIVE/CANCELED đều khóa đầu/dòng/file; chỉ ACTIVE tạo PR khi đủ quyền. Không có transition về Nháp hoặc xóa vật lý HĐ.
- Một file tùy chọn tại Thông tin chung. Chọn/thay/xóa chỉ áp dụng khi lưu; hiển thị tên/dung lượng, tooltip, tải xuống, thay và xóa theo quyền. HĐ khóa vẫn tải được theo quyền xem. Không sao chép sang PR.
- Notes append-only, mới nhất trước, tải thêm, áp dụng mọi trạng thái cho người có quyền xem. [document-records](../../apps/api/src/modules/document-records/document-records.ts) đã có target SALES_CONTRACT và cursor. Dùng common history với thời gian, action, actor, trạng thái sau, chi tiết; bỏ cột vòng. Ghi Create, thay đổi đầu/dòng/file, chốt và hủy kèm lý do trong transaction.

## E. Tích hợp PR và downstream

- [ScPrsTab](../../apps/web/src/features/sales-contracts/ScPrsTab.tsx) hiện tải mảng từ `/purchase-requisitions?salesContractId=`, chỉ hiển thị năm cột. Tái sử dụng phân trang `page/size` và scope từ `ProcurementService.listPrs`; kiểm đủ projection gồm mã, tên, phân loại, người/ngày đề nghị, ngày cần hàng, tổng thanh toán, tiền tệ, trạng thái và người đang xử lý. Link từ mã, giữ tab và grid khi quay lại. Giữ ngoại lệ xem của Sales phụ trách theo ADR-0014; đối chiếu thêm nhánh PM phụ trách có PR.CREATE trong `listPrs` với tab hiện chỉ mở cho PR.VIEW hoặc Sales phụ trách. Dữ liệu người xử lý lấy từ workflow hiện hành.
- [PrPageEditor](../../apps/web/src/features/procurement/PrPageEditor.tsx) Create hiện chưa nhận HĐ cố định từ nguồn. Giữ Create từ list PR và thêm context từ HĐ ACTIVE, prefill/khóa HĐ, không tự thêm dòng. Nút dựa trên khả năng tạo của Procurement, gồm scope và route Sales/PM; API đích kiểm lại. [pr-lines.ts](../../apps/web/src/features/procurement/pr-lines.ts) hiện gợi ý duy nhất theo catalog ID/loại; loại gợi ý này khi bỏ FK catalog. Đối chiếu mapping theo ID dòng, kể cả khi mã giống nhau. `ProcurementService` dùng `SalesContractFacade.lockActiveLines` kiểm ACTIVE và dòng cùng HĐ. Hàng bán bắt buộc mapping trước Gửi duyệt, Vật tư tùy chọn; nhiều PR line có thể dùng một dòng HĐ. Giữ ID mapping thủ công và đường đọc detail HĐ cho PR.
- `sales_contract_line_products` là bảng legacy. Kiểm kê API, permission, UI, seed, kiểm tra Product đã sử dụng và `GirService.unapprovedProducts` trước khi loại bỏ. Giữ `lockActiveLines` và các liên kết/quota theo ID dòng. Định hướng ĐNXK là PM đối chiếu mã hàng có thật trong kho với mã theo HĐ. Cách kiểm tra thay thế ở ĐNXK thuộc phase downstream. PR line là nguồn PO, PO line là nguồn GRR, GRR/GR tạo tồn và provenance, GIR nhận nguồn PR hoặc tồn và GI kế thừa GIR. FK trực tiếp trong `InboundChain`, `OutboundChain`, `InventoryLots`, `GirAvailableStockSource`; kiểm hồi quy cả tồn có `source_sales_contract_id`. Giữ `assignResponsiblePm` qua facade như metadata điều phối, tách khỏi dữ liệu hợp đồng đã khóa.
- Hủy ACTIVE từng hợp lệ khi PR/GIR không còn dùng; quy tắc mới loại đường này, kể cả ACTIVE legacy. Sau khi xác minh tham chiếu bất thường ở DRAFT, xử lý guard theo ownership/facade, tránh mở rộng SQL đọc ngược Procurement/Outbound hiện có. Đối chiếu race giữa hủy DRAFT với chốt trước khi chốt chiến lược khóa.

## F. Migration, atomic save và file · đề xuất kỹ thuật

1. Migration additive thêm số thực tế, tên, ngày HĐ, ngày giao và diễn giải nullable; thêm ghi chú dòng nullable. Giữ ID, mã, version, trạng thái, audit, liên kết dòng PR và CHECK Sales. BA cho phép bỏ hai FK catalog, CHECK đi kèm và bảng `sales_contract_line_products` sau khi rà dependency. HĐ cũ hiển thị trường thiếu dưới dạng trống và nháp phải bổ sung trường bắt buộc khi ghi. Chốt phương án cho caller downstream trước khi drop schema. Chọn index sau khi đo list queries.
2. Hợp đồng API đề xuất: Create và cập nhật batch nhận intent draft/finalize, header, lines, file intent; update và cancel có expected version. Một transaction khóa contract trước khi kiểm version/trạng thái, kiểm scope, validate field/dòng, đối chiếu ID trùng hoặc thuộc HĐ khác, update theo ID, insert dòng mới, chặn xóa có FK kể cả nguồn đã hủy. Cấp mã với workflow helper trong transaction Create. Cập nhật liên kết file, history, audit/version và chuyển trạng thái trước commit. Đường ghi cũ phải đi qua cùng invariant hoặc được loại sau khi kiểm caller; bỏ trường và endpoint dành riêng cho nghiệp vụ bị thay thế sau khi kiểm caller.
3. Dựa trên `ProcurementService` dùng `create_request_key` và fingerprint: unique theo actor/request key, serialize request trùng, replay trả cùng ID/mã với cùng payload, 409 khi dùng lại key cho payload khác. Lưu kết quả cùng transaction và xử lý replay trước kiểm version hoặc tiêu thụ staging. Client giữ key khi retry cùng payload sau lỗi mạng; đổi khi payload thay đổi. Architect chốt phạm vi replay cho update/chốt/hủy, kết hợp version để chống ghi đè và thao tác đồng thời.
4. Tái sử dụng [FileAttachmentCell](../../apps/web/src/shared/components/FileAttachmentCell.tsx), `DossierStorage`, file policy/validation và primitives staging từ [document-dossier](../../apps/api/src/modules/document-dossier). `DossierDocuments.save` hiện dựa vào dossier type/snapshot; đề xuất liên kết một slot trên HĐ, unique theo HĐ, dùng blob immutable và staging tương đương, tránh cấu hình dossier đầy đủ. Bind token với actor và Create key hoặc contract/edit session, kiểm quyền/chủ sở hữu khi tải stage và quyền xem khi tải file hiện hành. Đọc metadata/tải file phải từ liên kết đúng HĐ. Lưu trữ blob bền trước khi commit liên kết; trong transaction khóa staging, gắn file mới hoặc bỏ liên kết theo intent, đánh dấu token và ghi history. Giữ blob cũ qua rollback; cleanup staging hết hạn/file mồ côi sau grace period, kiểm lại mọi tham chiếu trước khi xóa và phối hợp lock với consume. Kiểm lỗi giữa ghi blob và ghi metadata, sau consume trước commit, retry và cleanup chạy song song. Chốt retention file đã thay/xóa và khả năng audit lịch sử trước khi xóa blob.
5. Trước áp dụng Dev, xác minh đích PostgreSQL Test, backup và thử restore, chụp đối chiếu count, PK/FK và nội dung các cột cũ, gồm các HĐ đã chốt/hủy và dòng có PR/GIR/association. Chạy up trên fixture legacy, kiểm bằng SQL và API. Chạy lại từ backup để diễn tập rollback; sau khi đã có dữ liệu mới ưu tiên rollback app tương thích schema additive hoặc fix forward. Down xóa cột sẽ mất dữ liệu mới nên cần phương án export/restore. Chỉ sau khi Test đạt mới backup và áp dụng Dev.

## G. Phase 5.2.3B theo dependency

| Checkpoint | Nội dung và điều kiện hoàn tất |
| --- | --- |
| B1 | Chốt §I, kiểm caller và schema, kế hoạch migration và kiểm chứng bản sao PostgreSQL Test. Bảo toàn ID dòng và facade nguồn. |
| B2 | Atomic save/state/authorization, idempotency và version; tích hợp file staging, notes/history. Unit và PostgreSQL integration kiểm rollback/concurrency. |
| B3 | Mở rộng common picker và attachment UI, hoàn thiện HĐ List/Create/Edit/View, grid inline, validation, navigation và action results. Kiểm browser và ảnh before/after theo UI-EVIDENCE-001. |
| B4 | PR tab, create context và mapping bằng ID dòng, loại luồng proposal sau khi xử lý dependency, hồi quy downstream, cập nhật fixture/test, chạy build và diff. |

## H. Phase 5.2.3C · Test matrix và BA retest

| Nhóm | Kỳ vọng |
| --- | --- |
| API/DB · validation | Lưu nháp rỗng thành công; chốt rỗng lỗi và không ghi; chốt trực tiếp tạo ACTIVE. Bao phủ từng trường bắt buộc, mã/tên whitespace, ĐVT sai, lượng 0/âm/quá ba số lẻ. Batch thêm/sửa/xóa, giữ ID cũ; chặn foreign/duplicate ID và xóa dòng còn tham chiếu. |
| API/DB · lỗi/race | Fault sau ghi header/dòng/file/history rollback đồng bộ. Retry sau commit trả cùng mã. Hai request cùng key, key cũ payload khác, hai phiên cùng version, save vs finalize/cancel và PR create đồng thời chốt. |
| API/DB · access | VIEW và scope trên list/get/file/notes, không tạo/sửa/chốt/hủy khi thiếu quyền; VIEW thêm note mọi trạng thái. DRAFT hủy với lý do/history. ACTIVE và CANCELED gọi trực tiếp API ghi/hủy bị chặn. Kiểm PR.VIEW, Sales scoped read và quyền PR.CREATE riêng. |
| File/storage | Upload, replace, remove, download; policy MIME/size dùng chung, token sai actor/HĐ/session/hết hạn, giữ file cũ khi rollback, dọn orphan và stage hết hạn; cleanup song song không xóa blob còn dùng. |
| Browser · F15–F20 | Double click/Enter chỉ tạo một HĐ; có Action Result và vào detail, guard chỉ hỏi khi rời dữ liệu bẩn, retry giữ form. Grid sửa nhiều dòng qua tab, focus lỗi, mã trùng vẫn lưu và icon không dịch layout, multiline đúng padding, single picker server-side ở 100.000+ và giữ số lượng, không ghi FK Master Data. PR multi-select tiếp tục hoạt động. |
| Browser · list/detail | Filter/search/sort/page server, reset và quay lại giữ state; deep link đúng Edit/View; file/notes/history theo quyền. Kiểm 1366×768, 1920×1080, responsive, keyboard và ảnh UI-EVIDENCE-001. |
| Legacy/PR/Kho | HĐ thiếu field mới vẫn đọc; nháp bổ sung mới lưu/chốt. So sánh ID, audit, link trước/sau migrate. Tạo PR từ list và HĐ, mapping bằng ID dòng, Hàng bán/Vật tư, nhiều PR line cùng HĐ line. Kiểm association, PO/GRR/GR và GIR A/B/C/D/GI, tồn và quota. |

Mở rộng các suite hiện có `sales-contract-lines.int.spec.ts`, `editing.int.spec.ts`, `procurement.int.spec.ts`, `pr-scope.int.spec.ts`, `pr-dossier.int.spec.ts`, `inbound.int.spec.ts`, `outbound.int.spec.ts`, `sales-contracts.test.tsx` và suite procurement web. Chạy fixtures ghi/xóa chỉ trên PostgreSQL Test đã xác minh. BA retest F15–F20 theo [runbook UAT](pr19-business-uat.md), retest F14 riêng trên PR và xác nhận điểm đổi thứ tự cột Dossier khi có checkpoint UI phù hợp.

## I. Quyết định cần BA/Architect

- Chốt cách xử lý dependency ĐNXK đang dùng xác nhận mã giao và thứ tự migration. ĐVT vẫn bắt buộc khi picker thiếu giá trị.
- BA chưa chốt việc tách Tạo/Sửa/Chốt/Hủy, Data Scope cụ thể, quyền lookup picker và hành vi với tổ hợp thiếu VIEW. Đối chiếu PR để đề xuất trước khi triển khai. Action Permission độc lập với Data Scope, cây tổ chức không cấp quyền và backend kiểm permission, scope, trạng thái.
- Architect chốt API batch/version, idempotency update/action, storage slot và retention; BA xác nhận độ dài trường mới và timezone nghiệp vụ dùng cho mặc định ngày.

## J. Tài liệu canonical

- [Business Flows](../02-BUSINESS-FLOWS.md), [Business Rules](../03-BUSINESS-RULES.md), [Permissions](../04-PERMISSIONS.md), [Acceptance Tests](../05-ACCEPTANCE-TESTS.md).
- [Architecture](../architecture/ARCHITECTURE.md), [Frontend](../architecture/FRONTEND.md), [roadmap File Attachment](../architecture/DOCUMENT-DOSSIER-ORGANIZATION-ROADMAP.md), ADR-0005/0008/0009/0017 và [Open Questions](../architecture/OPEN-QUESTIONS.md).
- [Business UAT](pr19-business-uat.md). Báo cáo technical review cũ vẫn là bằng chứng của baseline.

## K. Go/No-Go

BA duyệt đóng baseline kỹ thuật. Agent tiếp quản chốt các mục §I trước khi triển khai Phase B. Chỉ dọn dữ liệu test được phép sau khi xác minh môi trường và dependency, giữ Master Data, tài khoản, cấu hình và UAT còn cần. Phase A xác minh từ Git/source/tài liệu. F15 và F18 còn bước xác nhận browser trên build thực tế. Chưa chạy migration, fixture hay retest BA trong Phase A.

Kiểm chứng baseline trong Phase A

- `pnpm build` đạt API và web. Vite có cảnh báo chunk lớn hơn 500 kB.
- `pnpm --filter web test sales-contracts procurement` đạt 36 test trong 3 file.
- `pnpm --filter api test --runTestsByPath src/modules/document-dossier/dossier-file-validation.spec.ts` đạt 2 test.
- `git diff --check` đạt. Working tree chỉ có tài liệu Phase A. Integration PostgreSQL và browser visual evidence nằm trong B/C.
