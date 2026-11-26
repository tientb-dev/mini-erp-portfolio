# PR #19 · Business UAT

Baseline `6a88de3` trên `feat/pr-business-completion`. BA thực hiện kiểm thử từ UAT-01. Mỗi người dùng nên đăng nhập ở một hồ sơ trình duyệt hoặc cửa sổ riêng. Ghi kết quả quan sát, mã chứng từ và ảnh lỗi vào cột **Thực tế**. Đổi trạng thái thành **Pass**, **Fail** hoặc **Blocked** sau khi thực hiện. Tất cả ca bắt đầu ở **Not Run**.

Phạm vi kết thúc khi hai PR **Hoàn tất** và đã kiểm tra quản lý hồ sơ sau hoàn tất. Các màn hình PO, nhập kho, xuất kho và tồn kho nằm ngoài Business UAT này.

## Môi trường Dev

| Thành phần | Địa chỉ và trạng thái lúc chuẩn bị |
|---|---|
| Web | [Mini ERP](http://localhost:5180/) |
| API | [OpenAPI](http://localhost:3100/docs). Web và OpenAPI trả HTTP 200, CORS đúng origin web. |
| PostgreSQL | `mini_erp`, `localhost:5442`, 22 migration, migration cuối `1733270400000`. |
| Kho file | `.local/dossiers` trên máy chạy API. Đã đọc/ghi một file thăm dò và dọn file đó. File nghiệp vụ dùng luồng trong UAT-07. |
| Dữ liệu trước UAT | 31 HĐ bán, 0 PR. Có PCS (Cái), kho HCM, VND (precision 0, tỷ giá 1), KH-DEMO và NCC-DEMO đang hoạt động. Hãng, liên kết Hãng–NCC, mã chính, mã tạm, thuế suất và loại/cấu hình hồ sơ còn trống. |

Toàn bộ dữ liệu UAT dưới đây do BA tạo hoặc chỉnh qua giao diện. Dùng một HĐ bán và hai PR, giữ lại mã chứng từ hiển thị để tra cứu. Dùng chung tiền tố `UAT19` trong một lượt, thêm hậu tố cho lượt sau nếu mã đã tồn tại. Tránh chỉnh đối tượng Demo khi cần kiểm tra Inactive hoặc sửa tên danh mục.

Thứ tự chạy là UAT-01 → 02.01 → UAT-03 → 02.02 → UAT-04/05 → UAT-06 → UAT-07/08. Thực hiện 07.01 trước lần lưu đầu của mỗi PR. Quan sát thông báo trong ca 08.03 song song khi chạy UAT-06.

## Tài khoản kiểm thử

| Tài khoản | Vai trò dùng trong kịch bản |
|---|---|
| `admin` | ADMIN. Quản trị danh mục, cấu hình loại hồ sơ, quản lý hồ sơ PR ở View và phân công lại khi PR đủ điều kiện. |
| `sales` | SALES. Tạo HĐ, tự chọn làm Sales phụ trách, tạo và gửi hai PR. Có quyền tạo PR và xem HĐ. |
| `sales-head` | SALES_HEAD. Người phê duyệt tuyến Sales, được cấp quyền theo bước đang được giao. |
| `purchaser` | PURCHASING. Người tiếp nhận. Dùng ở vai trò chỉ đọc trên PR Nháp hoặc khi chưa tới bước tiếp nhận, vì có PR.VIEW và thiếu PR.DOSSIER_MANAGE. |
| `warehouse` | WAREHOUSE_MANAGER. Đối chứng ngoài phạm vi PR qua URL trực tiếp của PR UAT. |
| `approver`, `pm`, `pm-head` | Đăng nhập được, ngoài luồng chính. `approver` mang ADMIN, khác `sales-head`. Tập PM đang trống. |

Đã xác minh đăng nhập cả tám tài khoản. Lấy thông tin đăng nhập từ cấu hình Dev local hoặc người quản lý môi trường. Thiếu tài khoản chỉ có quyền PR.VIEW tuyệt đối. Nếu BA cần kiểm tra quyền ở mức tài khoản riêng, đánh dấu ca tương ứng **Blocked** cho tới khi người quản trị cấp tài khoản được phê duyệt. Luồng chính dùng đúng cấu hình đang có **Sales → sales-head**, **Receipt → purchaser**. Frontend hiện chưa có màn hình sửa tập ứng viên. Kiểm tra danh sách chọn trên PR và dùng OpenAPI ở chế độ đọc khi cần đối chiếu.

## Bộ dữ liệu đề xuất

| Hạng mục | Dữ liệu nhập trên UI |
|---|---|
| Khách hàng | `UAT19-KH` · Công ty Mô phỏng Thương mại |
| Nhà cung cấp | `UAT19-NCC` · Nhà cung cấp Thiết bị Mô phỏng |
| Hãng và liên kết | `UAT19-HANG` · Hãng Thiết bị Mô phỏng; liên kết `UAT19-NCC`. |
| ĐVT và kho | Dùng `PCS` (Cái) cho các dòng. Tạo `UAT19-BO` · Bộ và `UAT19-KHO` · Kho UAT để kiểm tra danh mục, không phát sinh nghiệp vụ kho. |
| Mã chính | `UAT19-MAIN` · Bộ nguồn mô phỏng, hãng `UAT19-HANG`, ĐVT PCS, không theo dõi serial. |
| Mã tạm | `UAT19-TEMP` · Giá đỡ mô phỏng, mô tả “Gia công theo mẫu”. |
| Tiền tệ | VND có sẵn. Tạo USD · Đô la Mỹ, precision 2, tỷ giá danh mục `24800`. |
| Thuế | `UAT19-VAT0` · Thuế UAT 0%, rate `0`. `UAT19-VAT75` · Thuế UAT 7,50%, rate `7,50`. |
| Loại hồ sơ | `UAT19-BAOGIA` · Báo giá UAT; `UAT19-BIENBAN` · Biên bản UAT. Cấu hình PR theo đúng thứ tự này. |
| Tệp do BA chuẩn bị | Hai PDF mẫu không chứa dữ liệu thật, tên `uat19-bao-gia-v1.pdf` và `uat19-bao-gia-v2.pdf`, mỗi file dưới 20 MiB. Một file `uat19-khong-hop-le.txt` để kiểm tra bộ lọc nếu hộp chọn file cho phép. |
| HĐ bán dùng chung | Khách hàng `UAT19-KH`, Sales phụ trách `sales`. Dòng 1 mã chính `UAT19-MAIN`, SL 10. Dòng 2 mã tạm `UAT19-TEMP`, SL 5. Dòng 3 nhập tự do `UAT19-FREE` · Nhãn theo yêu cầu, SL 8. Cả ba dùng PCS. Ghi mã HĐ hệ thống cấp. |
| PR Hàng bán | Tên “UAT19 Hàng bán”, HĐ nêu trên, VND. Hai dòng cùng `UAT19-MAIN`, `UAT19-NCC`, mapping cùng dòng HĐ số 1. Dòng 1 SL `1,250`, đơn giá `800,4`, thuế 7,50%. Dòng 2 SL `2`, đơn giá `499,75`, thuế 0%. |
| PR Vật tư | Tên “UAT19 Vật tư”, cùng HĐ, USD, tỷ giá thủ công `24900,12345678`. Dòng `UAT19-TEMP`, hãng `UAT19-HANG`, NCC `UAT19-NCC`, PCS, SL `2,125`, giá `12,3456`, thuế 7,50%, bỏ trống mapping dòng HĐ. |

### Số đối chiếu

| Chứng từ/dòng | Trước thuế | Tiền thuế | Thanh toán |
|---|---:|---:|---:|
| Hàng bán, dòng 1 | 1,250 × 800,4 = 1.000,5 → **1.001** | 1.001 × 7,50% = 75,075 → **75** | **1.076 VND** |
| Hàng bán, dòng 2 | 2 × 499,75 = 999,5 → **1.000** | **0** | **1.000 VND** |
| Hàng bán, tổng | **2.001** | **75** | **2.076 VND** |
| Vật tư, dòng và tổng | 2,125 × 12,3456 = 26,2344 → **26,23** | 26,23 × 7,50% = 1,96725 → **1,97** | **28,20 USD** |

Grid tổng cộng theo từng dòng đã làm tròn. Số 0 hợp lệ hiển thị **0**; số chưa xác định hiển thị **—**. Tỷ giá là VND trên một USD, tổng của PR Vật tư vẫn hiển thị USD.

## UAT-01 · Master Data

| Mã | Tài khoản | Điều kiện | Dữ liệu | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|---|
| 01.01 | admin | Đăng nhập | UAT19-KH, UAT19-NCC, UAT19-BO, UAT19-KHO | Vào từng mục Danh mục, tạo, mở lại qua cột mã. Tìm theo mã và thử lọc trạng thái. | Tìm thấy đúng bản ghi, mặc định Active. PCS và HCM có sẵn. | — | Not Run |
| 01.02 | admin | 01.01 | UAT19-HANG, UAT19-NCC | Tạo hãng, mở chi tiết, thêm NCC vào hãng và lưu. Mở lại để kiểm tra; thử tìm NCC đã liên kết trong picker. | Liên kết được lưu; mỗi cặp xuất hiện một lần. | — | Not Run |
| 01.03 | admin | 01.02 | UAT19-MAIN, UAT19-TEMP | Tạo mã chính và mã tạm. Thử lưu mã chính thiếu hãng trước khi bổ sung hãng. | Thiếu hãng bị chặn. Hai mã nằm đúng danh mục; mã tạm giữ mô tả. | — | Not Run |
| 01.04 | admin | 01.03 | UAT19-BO, UAT19-HANG | Tắt và bật lại ĐVT Bộ bằng Switch. Thử tắt Hãng còn mã chính Active. | Bộ được lọc đúng theo trạng thái. Tắt Hãng bị chặn, Switch giữ trạng thái và dialog nêu nguyên nhân. | — | Not Run |
| 01.05 | admin | Hai mức thuế chưa có | VND, USD, UAT19-VAT0, UAT19-VAT75 | Mở VND; tạo USD và hai thuế suất. Thử nhập thuế vượt 2 chữ số thập phân trước khi lưu 7,50%. | VND hiển thị tỷ giá 1. USD có precision 2. Thuế 0 và 7,50% lưu được; giá trị sai bị chặn. | — | Not Run |

## UAT-02 · Cấu hình hồ sơ và workflow

| Mã | Tài khoản | Điều kiện | Dữ liệu | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|---|
| 02.01 | admin | Danh mục hồ sơ trống | UAT19-BAOGIA, UAT19-BIENBAN | Tạo hai loại trong Danh mục. Mở Hệ thống → Cấu hình hồ sơ chứng từ → PR; chọn hai loại và xếp thứ tự Báo giá trước Biên bản. Lưu và mở lại. | Hai loại Active, đúng thứ tự. Thao tác trước nút Lưu chỉ có hiệu lực cục bộ. | — | Not Run |
| 02.02 | admin, sales | Pool hiện có | sales-head, purchaser | Admin có thể xem `GET /pr-workflow/routes` trên OpenAPI sau khi xác thực. Sau 03.01, Sales mở tab Người phê duyệt của PR mới, mở hai danh sách chọn. | Tuyến Sales trả sales-head, Receipt trả purchaser. Sales không xuất hiện với tư cách người tự xử lý. | — | Not Run |

## UAT-03 · HĐ bán

| Mã | Tài khoản | Điều kiện | Dữ liệu | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|---|
| 03.01 | sales | UAT-01 hoàn tất | HĐ dùng chung, ba dòng như bảng | Tạo HĐ, chọn mình phụ trách. Thêm lần lượt mã chính, mã tạm và nhập tự do. Lưu, mở lại rồi kích hoạt. Ghi mã HĐ. | Ba nguồn và dòng được giữ độc lập; nhập tự do không sinh mã danh mục. HĐ ACTIVE xuất hiện trong picker PR của Sales. | — | Not Run |

## UAT-04 · PR Hàng bán

| Mã | Tài khoản | Điều kiện | Dữ liệu | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|---|
| 04.01 | sales | HĐ ACTIVE | UAT19 Hàng bán | Tạo PR; thử Lưu nháp thiếu HĐ. Chọn HĐ và thử lưu khi chưa có hàng. Thêm dòng 1, đặt đơn giá 0 và tạm bỏ mapping; Lưu nháp. | Hai lần thiếu điều kiện bị chặn. Nháp có HĐ + một dòng hợp lệ lưu được với giá 0. Ghi mã PR. | — | Not Run |
| 04.02 | sales | 04.01 | Hai dòng theo bảng PR | Thử Gửi duyệt khi giá 0 hoặc thiếu mapping. Sau đó cập nhật giá, chọn mapping dòng HĐ số 1, thêm dòng 2 trùng mã và cùng NCC. Chọn người xử lý, lưu nháp và mở lại. | Gửi duyệt thiếu dữ liệu bị chặn. Hai dòng riêng, cảnh báo trùng mềm, tổng **2.076 VND**. Cả hai dòng liên kết đúng dòng HĐ số 1. | — | Not Run |

## UAT-05 · PR Vật tư

| Mã | Tài khoản | Điều kiện | Dữ liệu | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|---|
| 05.01 | sales | HĐ ACTIVE | UAT19 Vật tư, dòng mã tạm như bảng | Thử lưu thiếu HĐ, sau đó chọn HĐ. Chọn mã tạm, hãng, NCC, ĐVT và thuế. Chọn USD, quan sát tỷ giá danh mục, bật nhập thủ công, nhập tỷ giá đề xuất và bỏ mapping. Lưu nháp. | Thiếu HĐ bị chặn; nháp có HĐ lưu được khi mapping trống. Tỷ giá danh mục hiển thị 24800 trước khi ghi đè. Tổng **28,20 USD**. Ghi mã PR. | — | Not Run |
| 05.02 | sales | 05.01, chưa gửi duyệt | Cùng PR Vật tư | Mở lại, kiểm tra tỷ giá thủ công và precision. Bỏ chọn nhập thủ công, đối chiếu 24800. Bật lại và nhập `24900,12345678`, chọn người xử lý và lưu nháp. | Có thể trở lại tỷ giá danh mục. Giữ tỷ giá đã chọn sau khi mở lại, tổng vẫn tính theo USD. | — | Not Run |

## UAT-06 · Workflow và phân quyền

| Mã | Tài khoản | Điều kiện | Dữ liệu | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|---|
| 06.01 | purchaser, warehouse | PR Hàng bán Nháp | URL chi tiết đã ghi | Purchaser mở PR qua danh sách hoặc URL, kiểm tra nút sửa/gửi và tab Hồ sơ. Warehouse mở cùng URL trong phiên riêng. | Purchaser xem được và không có thao tác sửa, nhận hay lưu hồ sơ ở Nháp. Warehouse bị chặn ngoài phạm vi. | — | Not Run |
| 06.02 | sales, sales-head | 04.02, người xử lý đã chọn | PR Hàng bán; lý do “Bổ sung diễn giải UAT” | Sales Gửi duyệt. Sales-head Từ chối với lý do. Sales đọc lý do, bổ sung diễn giải rồi gửi lại. | Chờ duyệt → Bị từ chối → Chờ duyệt. Có vòng mới và vẫn giữ hai dòng. Sales thiếu quyền tự duyệt. | — | Not Run |
| 06.03 | sales-head, purchaser | 06.02 | PR Hàng bán | Sales-head phê duyệt. Purchaser vào thông báo hoặc danh sách rồi Tiếp nhận. | Chờ tiếp nhận → Hoàn tất; Stepper đủ ba bước. | — | Not Run |
| 06.04 | sales, sales-head, purchaser | 05.02, hồ sơ chưa nhập nội dung | PR Vật tư; lý do thu hồi “Kiểm tra vòng UAT” | Sales Gửi duyệt rồi Thu hồi khi đang chờ. Sales gửi lại; sales-head phê duyệt; purchaser tiếp nhận. | Thu hồi về Nháp. Vòng mới đi đến Hoàn tất với mapping trống và hồ sơ chưa có nội dung. | — | Not Run |
| 06.05 | admin | Có PR đang chờ và BA đã cấu hình thêm ứng viên hợp lệ | Người thay thế khác người hiện tại | Tại bước đang chờ, mở Phân công lại, chọn ứng viên và nhập lý do “Chuyển giao UAT”. Người mới tiếp tục bước. | Giữ trạng thái và vòng. Task cũ đóng, task mới đến người được giao. Nếu chỉ có một ứng viên như hiện tại, ghi **Blocked** sau khi kiểm tra điều kiện. | — | Not Run |

## UAT-07 · Hồ sơ chứng từ và snapshot

| Mã | Tài khoản | Điều kiện | Dữ liệu | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|---|
| 07.01 | sales | 02.01, trước lần lưu đầu của 04.01/05.01 | Hai loại hồ sơ đã cấu hình | Ngay khi đang tạo từng PR, mở Hồ sơ. Quay về Thông tin chung, lưu theo UAT-04/05 rồi mở lại tab. | Có Báo giá và Biên bản đúng thứ tự. Sales thiếu PR.DOSSIER_MANAGE nên chỉ đọc. | — | Not Run |
| 07.02 | admin | 06.03, hai PR đã lưu | PR Hàng bán, Báo giá, file v1 | Mở Hồ sơ của PR Hoàn tất. Tích Có bản giấy, nhập ngày 26/11/2026, người phát hành “NCC UAT”, tải v1. Chuyển tab rồi quay lại và Lưu hồ sơ. | Dữ liệu giữ qua chuyển tab. Popup thành công nêu đúng mã PR. Báo giá có giấy và file; Biên bản vẫn trống. Stepper, hàng hóa và trạng thái Hoàn tất giữ nguyên. | — | Not Run |
| 07.03 | admin, purchaser | 07.02 | File v2; Biên bản có giấy | Admin chọn thay v2 rồi Hủy bỏ, sau đó chọn lại và xác nhận. Bỏ tick Báo giá, tick Biên bản mà không tải file. Lưu. Purchaser tải file qua tên hiển thị. | Hủy giữ v1. Sau lưu Báo giá có file v2, checkbox tắt và dữ liệu phát hành còn nguyên. Biên bản có giấy, không file. Purchaser tải được nhưng không thấy nút thay/xóa. | — | Not Run |
| 07.04 | admin | 07.03 | File v2 | Bấm Xóa, xác nhận, kiểm tra thay đổi chưa lưu. Thử rời trang rồi ở lại. Lưu hồ sơ và xem tab Lịch sử. | Có cảnh báo thay đổi chưa lưu. Lưu xóa liên kết hiện hành, giữ dòng và dữ liệu giấy; nhật ký ghi người, thời gian, giá trị trước/sau. | — | Not Run |
| 07.05 | admin, sales | Hai PR đã lưu; hoàn thành 07.02–07.04 trước khi sửa danh mục | Đổi tên Báo giá thành “Báo giá UAT mới”; đưa Biên bản lên trước rồi ngừng sử dụng | Sửa tên loại và lưu lại thứ tự cấu hình. Sau đó ngừng sử dụng Biên bản. Mở hai PR cũ; mở một form PR mới đến tab Hồ sơ rồi thoát trước khi lưu. | Hai PR cũ giữ tên và thứ tự ban đầu. Form mới thấy tên mới và bỏ loại Inactive. Không sinh PR thứ ba. | — | Not Run |

## UAT-08 · PR List, tra cứu, ghi chú, lịch sử và thông báo

| Mã | Tài khoản | Điều kiện | Dữ liệu | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|---|
| 08.01 | admin, sales | Hai PR đã lưu | UAT19, mã HĐ, hai phân loại | Vào danh sách PR; tìm theo mã PR/tên/mã HĐ, lọc Hàng bán hoặc Vật tư, lọc Hoàn tất và ngày. Mở chi tiết rồi quay về danh sách. | Kết quả đúng phạm vi và đúng bộ lọc; tổng thanh toán và mã tiền tệ khớp chi tiết. | — | Not Run |
| 08.02 | sales, purchaser | Một PR đọc được | Ghi chú “Đối chiếu báo giá UAT19” | Sales thêm ghi chú và tải lại trang. Purchaser xem ghi chú. Kiểm tra tab Lịch sử của hai PR. | Ghi chú hiện tác giả/thời điểm. Lịch sử có phê duyệt, tiếp nhận và các lần từ chối/thu hồi tương ứng từng PR; hồ sơ có lịch sử riêng cùng tab. | — | Not Run |
| 08.03 | sales-head, purchaser | Thực hiện song song UAT-06 | Mã hai PR | Mở chuông thông báo ở các bước gửi, duyệt và nhận; kiểm tra “Chờ tôi xử lý” trước/sau hành động, đánh dấu đã đọc. | Task đến đúng người và mở đúng PR, hết thuộc tập chờ khi xử lý. Đánh dấu đã đọc cập nhật bộ đếm. | — | Not Run |

Nguồn đối chiếu gồm [Luồng nghiệp vụ](../02-BUSINESS-FLOWS.md), [Quy tắc nghiệp vụ](../03-BUSINESS-RULES.md), [Phân quyền](../04-PERMISSIONS.md), [Workflow PR](../architecture/decisions/ADR-0015-purchase-requisition-workflow.md) và [Quyết định PR #19](../architecture/decisions/ADR-0017-pr-business-completion.md).

## Retest Phase 5.2.1 · Master Data và Common UI

Bổ sung sau khi BA phát hiện F01–F10. Giữ nguyên kết quả đã ghi ở các nhóm phía trên. Chạy retest với tài khoản admin và dữ liệu UAT19 đã có; dùng mã mới có hậu tố -RETEST cho ca cần Lưu. BA đã xác nhận F01–F10 trước Phase 5.2.2.

Sau Phase 5.2.1, DB Dev cổng 5442 có 23 migration. Migration `1733356800000` bổ sung cột Mô tả tùy chọn. Dữ liệu UAT19 đã có được giữ nguyên.

| Mã | Tài khoản | Dữ liệu và điều kiện | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|
| F01 | admin | Mười danh mục | Mở từ cột mã, chuyển Edit, mở Create từ danh sách | Mã chính/Hãng full page; tám danh mục còn lại popup | BA xác nhận đã xử lý | Pass |
| F02 | admin | Bản ghi UAT19, mô tả hai dòng dài | Nhập và lưu; mở View và xem List | Mô tả optional, đúng dữ liệu, một dòng và tooltip khi cắt trong List | BA xác nhận đã xử lý | Pass |
| F03 | admin | Danh sách có từ khóa, trạng thái, sort và cỡ trang khác mặc định | Bấm Làm mới hai lần | Trở về Tất cả, trang đầu, 25 dòng, bỏ sort và tải lại; nút ngoài cùng bên phải | BA xác nhận đã xử lý | Pass |
| F04 | admin | Master List, Picker hoặc grid Hồ sơ | Quan sát header và thử cuộn tại 1366×768 và 1920×1080 | Header rõ, không xuống dòng, sticky nền đặc và icon còn đọc được | BA xác nhận đã xử lý | Pass |
| F05 | admin | Bản ghi có mô tả và tham chiếu | Pencil mở Edit. Copy mở Create, kiểm tra Mã trống và tham chiếu; Hủy. Quay lại danh sách đã lọc | Nhánh Copy giữ thuộc tính hợp lệ và không giữ liên kết Hãng–NCC; hủy giữ nguồn và trạng thái danh sách | BA xác nhận đã xử lý | Pass |
| F06 | admin | Hãng UAT19 và hai NCC Active | Thử Create/Edit Hãng, thêm nhiều NCC qua lọc/refresh, gỡ một mục, hủy rồi mở lại. Lặp và Lưu. Mở View | Picker chỉ có NCC Active chưa gắn; chỉ lưu khi bấm Lưu Hãng; View chỉ đọc. NCC đã liên kết vẫn hiện sau khi inactive | BA xác nhận đã xử lý | Pass |
| F07 | admin | Hãng full page và Khách hàng popup | Kiểm tra mã/tên, footer và quay lại khi đang sửa | Mã ngắn hơn tên, nút có icon, điều hướng ArrowLeft và Dirty Guard hoạt động | BA xác nhận đã xử lý | Pass |
| F08 | admin | Bản ghi Retest chưa dùng | Kiểm tra List/View/Edit, thử Switch Active/Inactive | Không có Xóa vật lý. Switch là điểm đổi trạng thái. Gỡ liên kết NCC giữ NCC | BA xác nhận đã xử lý | Pass |
| F09 | admin | Mã chính có Hãng/ĐVT và Khách hàng thiếu mô tả | Mở View, chọn và sao chép giá trị; chuyển Edit | Chữ rõ, không caret/xóa/required ở View; trống hiện dấu —; trạng thái là chip | BA xác nhận đã xử lý | Pass |
| F10 | admin | Popup Khách hàng, Loại hồ sơ, Supplier Picker | Kiểm tra header và footer; dùng Tab/Escape và cuộn nội dung | Header trắng căn giữa; body cuộn riêng; footer và focus giữ đúng | BA xác nhận đã xử lý | Pass |

## Retest Phase 5.2.2 · F11–F14

BA đã retest Master Data thành công theo bàn giao Phase 5.2.3A. F14 vẫn chờ BA retest trên PR. Ghi nhận thêm yêu cầu chuyển cột Ghi chú xuống sau cột File đính kèm trong PR Dossier; xử lý tại checkpoint UI được duyệt.

### HĐ bán · F15–F20

UAT đang dừng tại HĐ. Phase 5.2.3A ghi nhận findings và thiết kế BA đã chốt trong [assessment](pr19-phase-5.2.3a-sales-contract-assessment.md). BA retest sau triển khai Phase B.

| Finding | Kịch bản retest | Kết quả mong đợi |
| --- | --- | --- |
| F15 | Tạo HĐ và nhấn lưu liên tiếp, thử retry sau mất phản hồi | Một HĐ, có Action Result, mở chi tiết và Dirty Guard không hỏi lại sau lưu |
| F16 | Tìm/lọc/sort/chuyển trang cả mã chính và mã tạm với danh mục lớn | Server chỉ trả trang hiện hành; HĐ chọn một, PR vẫn chọn nhiều |
| F17 | Nhập tay và dùng picker cho dòng HĐ, sau đó tạo PR | HĐ lưu snapshot; PR chọn catalog và map dòng HĐ mới bằng tay |
| F18 | So sánh mô tả yêu cầu và diễn giải với multiline Master Data | Padding nhất quán, diễn giải và ô file mặc định cùng chiều cao |
| F19 | Nhập mã trùng rồi đổi hoặc xóa dòng | Icon amber trong input, tooltip chỉ rõ dòng, không dịch layout, lưu được |
| F20 | Thêm/sửa/xóa nhiều dòng, chuyển tab và lưu/chốt | State giữ qua tab, lưu batch, lỗi mở tab và focus đúng ô |

### Kịch bản retest Phase 5.2.2

BA retest bốn ca dưới đây trước khi tiếp tục luồng HĐ bán → PR. Dùng lại bản ghi và PR UAT19; tạo mã hậu tố -F11 nếu cần thử Create/Copy. Kiểm tra giao diện đại diện ở 1366×768 và 1920×1080.

| Mã | Tài khoản | Dữ liệu và điều kiện | Thao tác UI | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|---|---|---|
| F11 | admin | Hãng full page, Khách hàng popup; List có lọc, sort và cỡ trang đã chọn | Từ List mở Edit bằng Pencil rồi thử hủy, đóng/quay lại, và lưu; lặp trong View → Edit; thử Create/Copy, đổi trường rồi hủy, lưu mã mới và thử mã trùng | Edit từ List, Create và Copy trả về cùng List; View → Edit trả về View có dữ liệu mới sau lưu; Dirty Guard xác nhận trước khi bỏ; lỗi giữ form và mode | — | Chờ BA Retest |
| F12 | admin | Hãng có ít nhất hai NCC Active chưa liên kết; PR có mã chính và mã tạm | Mở Supplier Picker, chọn một dòng rồi chọn cả trang, đổi sort/trang, tìm và Làm mới; thử Hủy rồi mở lại và Xác nhận. Lặp thao tác chọn trang ở Product Picker | Checkbox chọn một phần hiển thị đúng. Chọn cả trang chỉ đổi các dòng trang hiện tại. Lựa chọn giữ qua thay đổi truy vấn; chỉ Xác nhận áp dụng vào form. Search/Làm mới cao 36px | — | Chờ BA Retest |
| F13 | admin | Danh mục, PR List, grid hàng hóa PR và Hồ sơ có từ hai dòng | So sánh màu xen kẽ, rê chuột, chọn dòng, cuộn ngang và dọc; thử trường nhập lỗi ở grid hàng hóa | Sticky đồng màu với dòng. Màu chọn ưu tiên khi hover; lỗi nhập và cảnh báo trùng vẫn rõ; kích thước dòng ổn định | — | Chờ BA Retest |
| F14 | admin và người chỉ đọc PR | PR có hồ sơ với các loại Active; PDF kiểm thử | Trên các dòng hoặc qua các lần lưu, thử 4 tổ hợp Có bản giấy/File. Khi bỏ tích, nhập ngày 26/11/2026, người phát hành NCC UAT, ghi chú “Đối chiếu F14”; tích rồi bỏ tích, lưu, tải lại, kiểm tra Lịch sử, rồi mở PR bằng người chỉ đọc | Header một tầng; metadata luôn sửa được khi có quyền và giữ sau khi bỏ tích/tải lại. Checkbox và file độc lập. Lịch sử phản ánh trước/sau. Người chỉ đọc xem metadata và tải file hiện hành | — | Chờ BA Retest |
