# Mini ERP MVP — Kịch bản nghiệm thu nghiệp vụ
**Trạng thái:** MVP baseline (2026-11-13). Thay đổi tiếp theo phải ghi nhận qua ADR/OPEN-QUESTIONS.

## A. HĐ / PR / PO
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| A01 | Một HĐ `ACTIVE` tạo PR-1 và PR-2 | Cả hai PR cùng tham chiếu HĐ, mỗi PR chỉ một HĐ; dòng PR hàng bán tham chiếu dòng HĐ |
| A02 | PO gom dòng từ hai PR khác HĐ nhưng cùng nhà cung cấp | Cho phép; từng dòng giữ nguồn PR |
| A03 | PO chứa dòng từ hai nhà cung cấp | Không cho phép |
| A04 | Tổng PO Chờ duyệt + Đã duyệt vượt lượng dòng PR | Chặn Gửi duyệt |
| A05 | PR dùng hai dòng cùng PN (vd. hai dòng HĐ khác nhau cùng Product, hoặc một dòng hàng bán và một dòng vật tư) | Cho phép, hai dòng là hai nhu cầu riêng; mỗi dòng giữ `sales_contract_line_id` riêng (rỗng với dòng vật tư) |
| A06 | PR Đã duyệt có PO chưa Hủy | Chặn Thu hồi/Hủy PR |
| A07 | Dòng PR chọn mã tạm, không chọn UoM | Không lưu được dòng |
| A08 | Dòng PR chọn mã chính | UoM lấy từ `products`; snapshot mã/tên/mô tả/UoM được lưu |
| A09 | Mapping mã tạm → mã chính tại PO | `purchase_requisition_lines.product_id` được ghi; mọi PO/GRR (kể cả đã duyệt) tham chiếu dòng PR đó hiển thị mã chính; snapshot ban đầu giữ nguyên |
| A10 | Mapping lần hai trên dòng PR đã có mã chính (mã tạm đã map hoặc mã chính từ đầu) | Chặn |
| A11 | Hai người mapping đồng thời cùng dòng PR | Chỉ một thành công; người còn lại nhận lỗi |
| A12 | Mapping sang mã chính có UoM khác UoM snapshot dòng PR | Chặn — `MAPPING_UOM_MISMATCH`; `product_id`, UoM, số lượng không đổi |
| A13 | GRR Nháp còn dòng mã tạm | Lưu Nháp được; Gửi duyệt bị chặn — `GRR_LINE_NOT_MAPPED` |
| A14 | GRR có dòng UoM khác UoM hiện hành của mã chính | Gửi duyệt bị chặn — `GRR_LINE_UOM_MISMATCH` (backend, từng dòng) |
| A15 | Như A14, người dùng đã sửa số lượng | Vẫn bị chặn — không quy đổi UoM trong MVP |
| A16 | Đổi `is_serial_tracked` của PN từng có trên GRR/GR/GIR/GI ở bất kỳ trạng thái nào (kể cả `DRAFT`, `CANCELED`) | Chặn |
| A17 | Tạo mã chính mới không chỉ định cờ SN | `is_serial_tracked = true` |
| A18 | Mapping trên PO hoặc GRR ở `WAITING_FOR_APPROVE`/`APPROVED`/`REJECTED`/`CANCELED` | Chặn — `DOCUMENT_NOT_DRAFT` |
| A19 | Mapping trên PO/GRR `DRAFT` bởi người không có quyền sửa chứng từ đó | Chặn |
| A20 | Hai dòng PR cùng mã tạm; mapping dòng thứ nhất | Chỉ dòng thứ nhất có mã chính; dòng thứ hai vẫn là mã tạm; mã tạm vẫn chọn được cho PR mới |
| A21 | Mapping dòng PR làm đổi mã hàng hiển thị trên PO đã `APPROVED` | Cho phép (ngoại lệ có chủ đích); số lượng, UoM và nội dung đã duyệt không đổi |
| A22 | Dòng HĐ lưu mã/tên hàng chưa chuẩn hóa (không chọn mã chính) | Cho phép (thay thế quy tắc T3 cũ) |
| A28a | Dòng PR hàng bán tham chiếu `sales_contract_line_id` của HĐ `ACTIVE` | Bắt buộc với dòng hàng bán; snapshot yêu cầu ban đầu được lưu |
| A32 | Tạo PR từ màn hình HĐ `ACTIVE` có 3 dòng | Form PR được copy đủ 3 dòng và thông tin liên quan; người dùng sửa trước khi lưu; mỗi dòng PR giữ đúng `sales_contract_line_id` gốc |
| A33 | Trong cùng một PR hàng bán, thêm dòng thứ hai cho cùng một dòng HĐ (chia hoặc trùng) | Không cho phép |
| A33a | HĐ có hai dòng cùng Product; tạo PR từ HĐ | Hai dòng PR riêng, mỗi dòng giữ `sales_contract_line_id` của mình; không gộp |
| A33b | PR-1 và PR-2 cùng tham chiếu một dòng HĐ | Cho phép |
| A33d | Trong cùng một PO, hai dòng PO tham chiếu cùng một dòng PR (tạo hoặc sửa) | Không cho phép — `DUPLICATE_SOURCE_LINE`; dữ liệu đã lưu không đổi |
| A33e | PO-1 và PO-2 cùng tham chiếu một dòng PR, tổng ≤ số lượng dòng PR | Cho phép |
| A33c | PR trộn dòng hàng bán và dòng vật tư | Không cho phép trong MVP |
| A34 | Dòng PR hàng bán tham chiếu dòng HĐ thuộc HĐ khác HĐ của PR | Không cho phép |
| A35 | Tạo PR vật tư tại màn hình PR: chọn HĐ `ACTIVE` rồi chọn vật tư, không chọn dòng HĐ | Cho phép; dòng PR phân loại vật tư, `sales_contract_line_id` rỗng; PR gắn HĐ |
| A35a | PR vật tư dùng mã tạm | Cho phép; GRR liên quan không Gửi duyệt được khi chưa mapping (như A13) |
| A36 | PR vật tư chọn Product trùng Product đã được Sales xác nhận cho một dòng HĐ | Dòng PR vẫn không có `sales_contract_line_id`; hệ thống không tự gán dòng HĐ |
| A37 | PR vật tư chọn HĐ `DRAFT` hoặc `CANCELED` | Không cho phép |
| A23 | Tạo dòng PO từ dòng PR | Dòng PO lưu UoM = UoM snapshot dòng PR; dòng GRR tạo từ dòng PO lưu UoM = UoM dòng PO |
| A24 | Mapping thành công (cùng UoM) | UoM và số lượng của PR, mọi PO (kể cả `APPROVED`) và GRR không đổi |
| A25 | Dòng PR có hai dòng PO (một `APPROVED`); mapping từ GRR `DRAFT` sang mã chính khác UoM của một trong hai dòng PO | Chặn toàn bộ — `MAPPING_UOM_MISMATCH` |
| A26 | Mapping đồng thời với tạo dòng PO mới từ cùng dòng PR | Hai thao tác tuần tự; không có dòng PO nào có UoM khác mã chính sau khi mapping thành công |
| A27 | Mapping trên PO/GRR không ở `DRAFT` | Chặn — `DOCUMENT_NOT_DRAFT` |
| A28 | Đổi UoM mã chính đã xuất hiện trên PR/PO/GRR/GR/HĐ/GIR/GI (kể cả chứng từ `DRAFT` hoặc `CANCELED`) | Chặn — `PRODUCT_UOM_LOCKED` |
| A29 | Đổi UoM mã chính chưa xuất hiện trên chứng từ nào (chỉ có dòng PR mã tạm chưa mapping tới nó) | Cho phép |
| A30 | Đổi UoM mã chính sau khi một dòng PR mã tạm đã mapping sang nó | Chặn — `PRODUCT_UOM_LOCKED` |
| A31 | Mapping sang mã chính đồng thời với sửa UoM của mã chính đó | Chỉ một thao tác thành công; không tồn tại trạng thái mapping thành công với UoM khác dòng PR/PO |

## B. GRR / GR
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| B01 | Một PO được chia thành nhiều GRR | Cho phép trong hạn mức dòng PO |
| B02 | Hai GRR Chờ duyệt cộng lại vượt số lượng dòng PO | Chặn thao tác làm vượt |
| B03 | GR Nháp của PN có SN chưa nhập đủ SN | Lưu Nháp được, Gửi duyệt bị chặn |
| B04 | GR 3 đơn vị có SN | Có 3 dòng chi tiết, mỗi dòng một SN duy nhất |
| B05 | GR 3 đơn vị không quản lý SN | Có 1 dòng chi tiết số lượng 3 |
| B06 | Nhập lại PN+SN từng được nhập và đã xuất | Bị chặn |
| B07 | GR Đã duyệt | Tăng tồn, tạo SN tồn kho; không Hủy trực tiếp |
| B08 | Người khai báo kho không phải người tạo sửa chi tiết GR Nháp | Cho phép nếu đúng quyền kho; không được Gửi duyệt thay người tạo |
| B09 | GR Chờ duyệt / Bị từ chối | Tồn không tăng, không có biến động nhập, không có SN tồn kho |
| B10 | Hai GR Chờ duyệt khai báo cùng PN+SN | Gửi duyệt được cả hai; GR duyệt trước thành công, GR còn lại bị chặn Duyệt với lỗi trùng SN và giữ nguyên Chờ duyệt (người duyệt có thể Từ chối) |
| B11 | Hai GR cùng PN+SN được Duyệt đồng thời | Chỉ một GR Đã duyệt; không có SN trùng trong tồn kho |
| B12 | Hủy GR Nháp hoặc Bị từ chối | Trạng thái Đã hủy, dữ liệu giữ nguyên, không tác động tồn; GRR tạo được GR mới |
| B13 | Hủy GR Chờ duyệt hoặc Đã duyệt | Bị chặn |
| B14 | GR Đã hủy | Không sửa, không Gửi duyệt lại |
| B15 | Thu hồi GR Chờ duyệt | Về Nháp, không tác động tồn |
| B16 | Thu hồi GR Đã duyệt, chưa có GI nào dùng hàng | Về Nháp; tồn, biến động, SN tồn kho của lần duyệt bị hoàn tác; chi tiết GR giữ nguyên; tiến độ nhập PO giảm; lịch sử Duyệt/Thu hồi được lưu |
| B17 | Thu hồi GR Đã duyệt khi một SN đã xuất bởi GI Đã duyệt | Chặn toàn bộ |
| B18 | Thu hồi GR Đã duyệt khi một SN đang giữ chỗ bởi GI Chờ duyệt | Chặn toàn bộ |
| B19 | PN không SN: tồn 10, GI Chờ duyệt giữ 6, thu hồi GR nhập 5 | Chặn (còn 5 < 6 giữ chỗ) |
| B20 | Thu hồi GR Đã duyệt đồng thời với Gửi duyệt GI dùng hàng của GR đó | Chỉ một thao tác thành công; không âm tồn, không giữ chỗ SN không tồn tại |
| B21 | GR thu hồi rồi Duyệt lại cùng SN | Cho phép; tồn ghi nhận một lần, không trùng biến động |
| B22 | GR mới khai báo SN từng thuộc GR đã thu hồi (GR cũ chưa duyệt lại) | Cho phép Duyệt nếu SN chưa được ghi nhận nhập kho ở nơi khác |
| B23 | Thu hồi GR Đã duyệt khi một SN của GR được GI Nháp hoặc Bị từ chối tham chiếu | Chặn toàn bộ; SN không bị tự gỡ khỏi GI |
| B24 | Như B23 nhưng GI đã Hủy hoặc SN đã được gỡ khỏi GI | Cho phép Thu hồi nếu các điều kiện khác đạt; dòng SN trên GI đã Hủy vẫn giữ nguyên |
| B25 | Gửi duyệt GR có hai dòng chi tiết cùng PN+SN, hoặc SN đã có trong Inventory | Chặn |
| B26 | Thu hồi GR Đã duyệt đồng thời với lưu GI Nháp chọn SN của GR đó | Chỉ một thao tác thành công; không còn GI tham chiếu SN đã bị xóa khỏi Inventory |

## C. GIR theo HĐ (chung cho hai loại nếu không ghi khác)
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| C01 | Dòng GIR chọn dòng HĐ thuộc HĐ khác | Không cho phép |
| C02 | GIR `SALES_CONTRACT` khi chưa có tồn | Có thể lập/duyệt GIR; GI chưa thể xuất khi thiếu tồn |
| C03 | HĐ khách B dùng SN nhập cho HĐ khách A, cùng kho+PN | GI được chọn SN nếu khả dụng |
| C04 | Tổng GIR (`WAITING_FOR_APPROVE`/`APPROVED`/`REJECTED`) trên một dòng HĐ vượt số lượng dòng HĐ | Chặn khi Gửi duyệt/Duyệt |
| C05 | GIR `CANCELED` | Không chiếm hạn mức dòng HĐ |
| C06 | Hai dòng HĐ cùng PN | Hạn mức tính riêng theo `sales_contract_line_id`, không cộng gộp |
| C07 | Hai GIR Gửi duyệt đồng thời trên cùng dòng HĐ, tổng vượt hạn mức | Chỉ một thành công |
| C08 | GIR `DRAFT` với Product chưa được Sales xác nhận cho dòng HĐ | Lưu được; Gửi duyệt bị chặn |
| C09 | Sales xác nhận Product cho dòng HĐ | GIR không tự Gửi duyệt; PM Gửi duyệt được |
| C10 | GIR tham chiếu HĐ `DRAFT` hoặc `CANCELED` | Không cho phép |
| C11 | Quản lý kho xác nhận hoàn thành xuất khi còn GI `DRAFT` hoặc `WAITING_FOR_APPROVE` | Chặn; GI không bị tự Hủy |
| C12 | GIR 10, GI `APPROVED` 6, GI khác `CANCELED` 2; xác nhận hoàn thành xuất | GIR `COMPLETED`, `approval_status` vẫn `APPROVED`; chiếm hạn mức 6; giải phóng 4 |
| C13 | Tạo GI mới cho GIR `COMPLETED` | Chặn |
| C14 | Xác nhận hoàn thành xuất đồng thời với tạo GI mới | Chỉ một thao tác thành công |
| C15 | Thu hồi GIR `APPROVED` chưa có GI | Về `DRAFT`; phải Gửi duyệt và duyệt lại |
| C16 | Thu hồi GIR có GI `APPROVED` | Chặn |
| C17 | Thu hồi GIR mà mọi GI đã `CANCELED` | Cho phép |
| C18 | Sửa GIR đang `WAITING_FOR_APPROVE` | Chặn; phải Thu hồi trước |
| C19 | Hoàn thành xuất khi còn GI `REJECTED` | Chặn; phải Hủy GI trước |
| C20 | Hoàn thành xuất khi lượng thực xuất < số lượng GIR, không nhập lý do | Chặn; bắt buộc lý do |
| C21 | GIR `APPROVED` chưa có GI / có GI `APPROVED` chưa hoàn thành / đã xác nhận hoàn thành | `execution_status` lần lượt `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED` |
| C22 | Hai dòng HĐ khác nhau; nhiều Product `APPROVED` trên một dòng HĐ | Hạn mức chỉ theo dòng HĐ, không giới hạn riêng từng Product |
| C23 | Luồng D: GIR `AVAILABLE_STOCK` vật tư chọn HĐ `ACTIVE`, kho, người phụ trách và vật tư, có mục đích sử dụng | Cho phép; dòng không có `sales_contract_line_id`; GIR gắn HĐ |
| C23a | Luồng D không ghi mục đích sử dụng | Không cho phép |
| C24 | Luồng D chọn vật tư nhập từ PR của HĐ khác (hoặc không qua PR nào của HĐ này) | Cho phép (khi người phụ trách đồng ý) |
| C25 | Dòng GIR vật tư dùng Product chưa từng được Sales xác nhận cho dòng HĐ nào | Gửi duyệt không bị chặn bởi điều kiện xác nhận Product |
| C26 | Dòng HĐ 10 đã có GIR hàng bán 10; tạo GIR vật tư (C hoặc D) cùng Product | Không bị chặn bởi hạn mức dòng HĐ; hạn mức dòng HĐ vẫn 10/10 |
| C27 | GIR vật tư chọn Product trùng Product đã xác nhận cho một dòng HĐ | Không tự gán `sales_contract_line_id`, không trừ hạn mức dòng HĐ đó |
| C28 | Dòng GIR hàng bán (A hoặc B) không có dòng HĐ | Không cho phép |
| C29 | GIR vật tư tham chiếu HĐ `DRAFT` hoặc `CANCELED` | Không cho phép |
| C30 | Sales thu hồi xác nhận Product chỉ được dòng GIR vật tư chưa `CANCELED` dùng | Không bị chặn bởi dòng vật tư (G12 chỉ xét dòng hàng bán) |
| C31 | GIR vật tư Gửi duyệt/Duyệt; GI xuất vật tư có SN | Theo quy tắc duyệt, người tạo không tự duyệt, phạm vi kho, SN, tồn khả dụng như GIR hàng bán |
| C32 | GIR trộn dòng hàng bán và dòng vật tư | Không cho phép trong MVP |
| C33 | Luồng A/C: PR chưa `PO done` | Không xuất hiện khi lập GIR theo PR |
| C34 | Luồng A/C: PR đã `PO done` nhưng chưa có GR `APPROVED` | PR xuất hiện; lượng đã nhập hiển thị 0; vẫn lập và duyệt được GIR; GI chưa xuất được khi thiếu tồn |
| C35 | Dòng PR 10, nhập hai đợt GR `APPROVED` 4 và 3, một GR khác `DRAFT` 2 | Lượng đã nhập hiển thị 7 (chỉ GR `APPROVED`, theo chuỗi dòng PR → PO → GRR → GR) |
| C36 | Như C35, GIR đề nghị 9 | Cho phép (≤ 10 của dòng PR); lượng nhập 7 không phải hạn mức GIR |
| C37 | Hai dòng PR cùng Product, mỗi dòng 5; GIR đề nghị 6 trên một dòng PR | Chặn — hạn mức tính riêng từng dòng PR, không cộng gộp theo Product |
| C37a | Lượng đã nhập của hai dòng PR cùng Product | Hiển thị riêng từng dòng PR, không ghép theo Product |
| C38 | Dòng PR 10 đã có GIR `APPROVED` 10; Gửi duyệt GIR mới cho cùng dòng PR | Chặn — vượt hạn mức dòng PR |
| C39 | Dòng HĐ 10; PR-1 và PR-2 cùng tham chiếu, mỗi dòng PR 10; GIR luồng A trên PR-1 đề nghị 6, trên PR-2 đề nghị 5 | GIR thứ hai bị chặn — hai PR dùng chung hạn mức giao dòng HĐ (còn 4) |
| C40 | Dòng HĐ 10; GIR luồng A 6; GIR luồng B cùng dòng HĐ đề nghị 5 | Chặn — A và B dùng chung hạn mức giao dòng HĐ |
| C41 | GIR luồng A và luồng B Gửi duyệt đồng thời trên cùng dòng HĐ, tổng vượt hạn mức | Chỉ một thành công |
| C42 | Luồng C: dòng PR vật tư 5, GIR đề nghị 5 | Chỉ kiểm soát hạn mức dòng PR; không đụng hạn mức dòng HĐ |
| C43 | Luồng A với Product chưa được Sales xác nhận cho dòng HĐ | Lưu `DRAFT` được; Gửi duyệt bị chặn |
| C44 | Luồng A/C | Phê duyệt một cấp; không có bước người phụ trách nguồn hàng |
| C45 | PR 2 dòng; dòng 1 có PO `APPROVED` đủ, dòng 2 có PO `APPROVED` 6/10 | Chưa `PO done`; PR không xuất hiện khi lập GIR theo PR |
| C46 | Dòng PR 10 mua qua PO-1 `APPROVED` 4 và PO-2 `APPROVED` 6; các dòng khác đủ | `PO done` |
| C47 | Dòng PR 10: PO `APPROVED` 6 và PO `WAITING_FOR_APPROVE` 4 | Chưa `PO done` (chỉ tính PO `APPROVED`) |
| C48 | Đã `PO done`, sau đó một PO `APPROVED` được Thu hồi/Hủy | Không còn `PO done`; PR không xuất hiện khi lập GIR mới; GIR đã có xử lý theo C58–C61 |
| C49 | Hai dòng PR cùng Product, dòng 1 có PO đủ, dòng 2 chưa | Chưa `PO done` — cộng theo dòng PR, không theo Product |
| C50 | Dòng HĐ 10 đã có GIR `APPROVED` 10; lưu GIR `DRAFT` mới 5 cùng dòng HĐ | Lưu được (`DRAFT` không chiếm); Gửi duyệt bị chặn |
| C51 | Hai GIR `DRAFT` cùng dòng HĐ 10, mỗi GIR 8 | Lưu được cả hai; GIR Gửi duyệt trước thành công, GIR sau bị chặn |
| C52 | Dòng HĐ 10; GIR `REJECTED` 6 và GIR `APPROVED` 4; sửa GIR `REJECTED` thành 5 rồi Gửi duyệt | Cho phép (5 + 4 ≤ 10; không tính trùng 6 đang giữ) |
| C53 | Như C52, sửa GIR `REJECTED` thành 7 | Chặn khi Gửi duyệt |
| C54 | GIR `REJECTED` | Vẫn chiếm hạn mức dòng HĐ/dòng PR cho đến khi Hủy |
| C55 | Hạn mức dòng PR: GIR `DRAFT` không chiếm; `WAITING_FOR_APPROVE`/`REJECTED`/`APPROVED` chiếm; `CANCELED` không | Như hạn mức dòng HĐ |
| C56 | Luồng C, PR có mục đích sử dụng | GIR kế thừa để tham khảo; không bắt buộc nhập lại; không ảnh hưởng hạn mức/duyệt |
| C57 | Luồng C, PR không có mục đích sử dụng | Gửi duyệt không bị chặn |
| C58 | GIR `DRAFT` luồng A/C lập khi PR `PO done`; trước khi Gửi duyệt, PR mất `PO done` | Gửi duyệt bị chặn (backend); GIR vẫn `DRAFT` |
| C59 | GIR `REJECTED` luồng A/C sửa và Gửi duyệt lại khi PR không còn `PO done` | Gửi duyệt bị chặn; GIR vẫn `REJECTED` |
| C60 | GIR luồng A/C đã Gửi duyệt hợp lệ (`WAITING_FOR_APPROVE` hoặc `APPROVED`), sau đó PR mất `PO done` | GIR không bị tự Hủy/Thu hồi/đổi trạng thái; tiếp tục duyệt, lập GI theo workflow và hạn mức hiện hữu |
| C61 | Như C58, sau đó PR đạt lại `PO done` (PO `APPROVED` mới bù đủ) | Gửi duyệt được |
| C62 | GIR luồng A lập và Gửi duyệt khi PR `PO done` nhưng chưa có GR | Được lập, Gửi duyệt, Duyệt; không kiểm tồn |
| C63 | Dòng GIR A/C chưa có GR `APPROVED` trong chuỗi dòng PR | GR tham chiếu và kho để trống |
| C64 | GIR A `APPROVED`; GR đầu tiên của dòng PR (kho HCM) được duyệt | Dòng GIR tự hiển thị GR đó + kho HCM; số lượng, trạng thái, người duyệt GIR không đổi |
| C65 | Như C64, GIR đang `WAITING_FOR_APPROVE` | Vẫn tự cập nhật GR tham chiếu; GIR tiếp tục chờ duyệt |
| C66 | Như C64, sau đó GR thứ hai (kho HN) được duyệt | GR tham chiếu vẫn là GR đầu tiên (kho HCM) |
| C67 | Dòng GIR có GR tham chiếu | Không giữ chỗ, không phân bổ tồn; GI chọn tồn theo 03 §4–§5 |
| C68 | PO 2 dòng (10, 5); chưa có GR `APPROVED` | PO: Chưa nhập kho; GIR không hiển thị tình trạng nhập kho |
| C68a | Như C68, GR `APPROVED` nhập 10 cho dòng 1 | PO: Nhập kho một phần |
| C68b | Như C68a, GR `APPROVED` nhập 5 cho dòng 2 | PO: Đã nhập kho |
| C68c | Như C68b, GR của dòng 2 được Thu hồi | PO: Nhập kho một phần (GR đã Thu hồi không tính) |
| C69 | GI cho GIR luồng A của HĐ-B; kho chỉ có hàng nhập từ PR của HĐ-A | Không chọn được hàng/SN của HĐ-A |
| C70 | GIR `AVAILABLE_STOCK` của HĐ-B dùng tồn thuộc Sales HĐ-A; Sales HĐ-A đồng ý, Quản lý kho duyệt; GI xuất | Xuất được; không tự sinh hoàn bù |
| C71 | Báo cáo tồn kho | Truy vết được theo Kho, Product, Sales phụ trách, HĐ nguồn, GR. *Tiến độ: PR code #3 hoàn thành phần **nguồn nhập** (lô, lượng nhập, `GET /inventories/lots`); **tồn còn lại theo lô** và FIFO thuộc PR code #4.* |
| C72 | HĐ có Sales phụ trách S1; GR từ PR của HĐ được duyệt | Tồn nhập ghi Sales phụ trách S1, HĐ nguồn là HĐ đó |
| C73 | Hàng không SN, HĐ-A có lô GR1 (duyệt trước, 3) và GR2 (duyệt sau, 5); GI luồng A xuất 4 | Lấy 3 từ GR1, 1 từ GR2 (FIFO) |
| C74 | Như C73, kho còn lô GR0 của HĐ-B duyệt sớm hơn | GI luồng A của HĐ-A không lấy GR0 |
| C75 | GR là GR tham chiếu của dòng GIR `DRAFT`/`WAITING_FOR_APPROVE`/`REJECTED`/`APPROVED` | Chặn Thu hồi GR |
| C76 | Như C75, mọi GIR tham chiếu đã `CANCELED`; không GI nào dùng hàng của GR | Thu hồi được; tồn hoàn tác |
| C77 | Như C76, nhưng SN của GR còn được GI chưa Hủy tham chiếu | Chặn Thu hồi (B17, B18, B23) |
| C78 | GIR B/D Gửi duyệt khi tồn khả dụng của Sales nguồn không đủ | Chặn Gửi duyệt; GIR không giữ chỗ tồn khi đủ |
| C79 | GIR B/D `APPROVED`; tồn giảm trước khi lập GI | GI kiểm tra lại, chặn khi không đủ |
| C80 | Thu hồi GR không SN; lô của GR đang được GI `WAITING_FOR_APPROVE` phân bổ | Chặn toàn bộ; không phân bổ lại GI |
| C81 | Như C80, GI đã `APPROVED` (đã xuất một phần lô), tổng Kho + PN vẫn đủ | Chặn (xét lô, không xét tổng) |
| C82 | Như C80, GI đó bị Từ chối/Thu hồi (phân bổ đã giải phóng); không GIR hiệu lực tham chiếu | Thu hồi được |
| C83 | Sửa Sales phụ trách HĐ `DRAFT` (S1 → S2), rồi chốt; GR từ PR của HĐ được duyệt | Lô ghi S2 |
| C83a | Sửa Sales phụ trách HĐ `ACTIVE` | Chặn |
| C83b | Người không có quyền sửa HĐ sửa Sales phụ trách HĐ `DRAFT` | Chặn |
| C84 | GIR B/D của HĐ-đích chọn Product từ HĐ-nguồn X và HĐ-nguồn Y | Không cho phép; lập GIR riêng cho từng HĐ nguồn |
| C85 | GIR B/D chọn nhiều Product cùng HĐ nguồn, cùng Sales nguồn, cùng kho | Cho phép |
| C86 | Dòng PR có GR1 (duyệt trước) là GR tham chiếu, GR2 duyệt sau; mọi GIR tham chiếu đã Hủy; Thu hồi GR1 | GR tham chiếu chuyển sang GR2 |
| C87 | Như C86 nhưng không còn GR `APPROVED` nào khác | GR tham chiếu để trống |
| C89 | GIR B/D chọn HĐ nguồn = HĐ đích | Không cho phép; dùng luồng A/C |
| C90 | GIR B/D chọn HĐ nguồn `CANCELED` | Không cho phép |
| C91 | GIR B/D chọn HĐ nguồn `ACTIVE` đã giao xong, còn hàng dư ở kho | Cho phép; bước 1 giao Sales ghi trên lô |
| C88 | GIR B/D đủ tồn khi Gửi duyệt; tồn giảm trước khi Quản lý kho duyệt | Chặn Duyệt; GIR giữ Chờ duyệt |

## D. GIR hàng có sẵn / GI
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| D01 | GIR `AVAILABLE_STOCK` không chọn HĐ, hoặc dòng hàng bán (luồng B) không chọn dòng HĐ | Không cho phép; không cần PR/PO. Luồng D (vật tư) không cần dòng HĐ (C23) |
| D02 | Kho HCM có PN-A, kho HN không có | Chỉ chọn PN-A cho loại hàng có sẵn tại HCM |
| D12 | GIR `AVAILABLE_STOCK` chọn kho không có `allow_available_stock_issue` (vd. kho dự án) | Không cho phép |
| D13 | Hạn mức dòng HĐ còn 8, tồn khả dụng của người phụ trách nguồn hàng 5 | Lưu `DRAFT` 6 được (cảnh báo); Gửi duyệt 6 bị chặn; tối đa 5 |
| D14 | Tồn khả dụng giảm còn 3 trong khi GIR 5 đang chờ duyệt | Không duyệt được |
| D15 | Người phụ trách nguồn hàng đồng ý GIR `AVAILABLE_STOCK` | Chưa `APPROVED`; chuyển sang bước Quản lý kho |
| D16 | Quản lý kho duyệt sau người phụ trách nguồn hàng | GIR `APPROVED` |
| D17 | Quản lý kho duyệt khi người phụ trách nguồn hàng chưa đồng ý | Không cho phép |
| D18 | GIR `AVAILABLE_STOCK` `APPROVED` thu hồi, giảm số lượng, Gửi duyệt lại | Duyệt lại từ bước người phụ trách nguồn hàng; xác nhận cũ hết hiệu lực |
| D19 | GIR `AVAILABLE_STOCK` | Không giữ chỗ tồn; chỉ GI Chờ duyệt giữ chỗ |
| D20 | Người phụ trách nguồn hàng hoặc Quản lý kho từ chối GIR `AVAILABLE_STOCK` | GIR `REJECTED`; PM nhận thông báo; muốn tiếp tục phải Thu hồi/sửa và duyệt lại từ bước đầu |
| D22 | GIR `AVAILABLE_STOCK` chọn hàng của hai người phụ trách nguồn hàng, hai HĐ nguồn, hoặc từ hai kho | Không cho phép; phải tạo GIR riêng |
| D23 | GIR `AVAILABLE_STOCK` chọn nhiều Product của cùng một người phụ trách tại một kho | Cho phép |
| D24 | Kho HCM: PN-A của người phụ trách X là 5, của Y là 3; GIR chọn nguồn X đề nghị 6 | Chặn — tồn khả dụng tính theo người phụ trách (5), không theo tổng Kho + PN (8) |
| D25 | Luồng B: HĐ của Sales S1, hàng của người phụ trách S2 | Bước 1 giao S2 (không phải S1) |
| D26 | Gửi duyệt GIR `AVAILABLE_STOCK` giao bước 1 cho người không phải người phụ trách nguồn hàng của GIR | Backend chặn |
| D27 | Duyệt GR có hàng được mua cho HĐ của Sales S1 | Người phụ trách nguồn hàng được ghi nhận cho lượng nhập đó (thường S1) |
| D21 | Chọn kho bảo hành/hàng hỏng cho `AVAILABLE_STOCK` | Không cho phép (mặc định không hợp lệ) |
| D03 | GI xuất 4 trong 10 đơn vị dòng GIR | Cho phép; dòng còn lại có thể được xuất đợt khác |
| D04 | Tồn thực tế 10, GI Chờ duyệt giữ 3 | GI mới chỉ dùng tối đa 7 khả dụng |
| D05 | GI Nháp lưu 7, tồn khả dụng sau đó còn 5 | Giữ Nháp và cảnh báo, chặn Gửi duyệt |
| D06 | GI chọn SN đã giữ chỗ ở GI khác | Chặn |
| D07 | GI Đã duyệt | Trừ tồn thực tế và không Thu hồi/Hủy |
| D10 | GI chọn SN chỉ có trên chi tiết GR Chờ duyệt hoặc GR đã bị Thu hồi | Chặn — SN không có trong tồn kho khả dụng |
| D11 | GI đã Hủy tham chiếu SN của GR, GR sau đó Thu hồi và sửa SN trên chi tiết | GI đã Hủy vẫn hiển thị SN snapshot lúc chọn |
| D08 | Hai GI Gửi duyệt đồng thời cùng lượng tồn cuối | Không được giữ chỗ vượt tồn |
| D09 | GIR hàng có sẵn yêu cầu số lượng lớn hơn tồn khả dụng | Chặn (xem D13) |

## E. Tồn kho / lịch sử / phân quyền
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| E01 | Hai GR khác PR cùng PN vào một kho | Tồn báo cáo cộng chung theo Kho+PN |
| E02 | GI xuất PN từ GR của HĐ khác | Cho phép nếu PN/SN khả dụng |
| E03 | Tìm SN đã xuất (qua dòng hàng bán hoặc dòng vật tư) | Thấy GR, GRR, PO, PR nhập; GIR, GI xuất và HĐ của GIR (mọi GIR đều gắn HĐ ở cấp chứng từ) |
| E04 | Người không có quyền kho tìm SN chỉ có ở kho đó | Không trả thông tin tiết lộ SN |
| E05 | Người tạo Gửi duyệt chứng từ của mình và tự Duyệt | Tự Duyệt bị chặn |
| E06 | Người có quyền duyệt nhưng không có quyền sửa | Duyệt/Từ chối được, sửa nội dung không được |
| E07 | GR hoặc GI Đã duyệt có ghi chú bổ sung | Cho phép thêm ghi chú đúng quyền, không sửa dữ liệu chính |
| E08 | Gửi duyệt: người duyệt được tự điền theo role/bước; người tạo đổi sang người khác đủ điều kiện | Cho phép |
| E09 | Gửi duyệt chọn người duyệt không đủ quyền (hoặc không có kho tương ứng) | Backend chặn |
| E10 | Không có người duyệt mặc định, có nhiều người hợp lệ | Bắt buộc người tạo chọn |
| E11 | PM tự xác nhận Product cho dòng HĐ | Chặn — chỉ Sales |
| E12 | Người dùng mở chứng từ không đủ quyền thao tác | Thấy lý do rõ ràng trên UI |
| E13 | Người có quyền duyệt nhưng không phải người được giao duyệt chứng từ | Không thấy trong "Chờ tôi duyệt", không nhận thông báo, Duyệt bị chặn |
| E14 | Sửa tên dịch (`en`) của Product đã được dùng | Chặn |
| E15 | Thu hồi/Hủy PO Đã duyệt khi còn GRR chưa Hủy | Chặn |
| E16 | Tải lên file đính kèm | Lưu file ở storage backend, metadata trong DB |

## G. HĐ bán
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| G01 | Sales tạo HĐ | `DRAFT`, có `document_number` dạng `SC-YYYY-NNNNNN` |
| G02 | Sales chốt HĐ | `ACTIVE`; nội dung nghiệp vụ bị khóa |
| G03 | Tạo PR tham chiếu HĐ `DRAFT` | Không cho phép |
| G04 | Sửa khách hàng/PN/UoM/số lượng của HĐ đã được PR/GIR tham chiếu | Chặn |
| G05 | Dòng HĐ chưa có Product chính thức | Cho phép |
| G06 | PM đề xuất Product thay thế cho dòng HĐ, có lý do; Sales xác nhận | Lưu người xác nhận, thời điểm, ghi chú/số phụ lục; dòng HĐ có thêm Product được phép giao |
| G07 | Sales từ chối đề xuất | Product không được phép giao cho dòng HĐ |
| G08 | Hủy HĐ còn PR hoặc GIR chưa `CANCELED` tham chiếu | Chặn |
| G09 | Hủy HĐ khi mọi PR/GIR tham chiếu đã `CANCELED` | Cho phép |
| G10 | Chuyển HĐ `ACTIVE` về `DRAFT` | Không cho phép |
| G11 | Đề xuất Product: PM tạo → `PENDING`; Sales duyệt → `APPROVED` hoặc từ chối → `REJECTED` | Chỉ Product `APPROVED` cho phép Gửi duyệt GIR |
| G12 | Sales thu hồi xác nhận Product đang được dòng GIR hàng bán chưa `CANCELED` dùng | Chặn |
| G13 | Product chỉ có đề xuất `PENDING`/`REJECTED` cho dòng HĐ, chưa có chứng từ khác | Chưa tính là "đã sử dụng" — mã/tên/UoM vẫn sửa được |

## H. Đánh số, hủy, Product
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| H01 | Tạo PR/PO/GRR/GR/GIR/GI | Số tự sinh theo tiền tố loại, năm, 6 chữ số; dãy riêng từng loại |
| H02 | Sang năm mới | Dãy số mỗi loại bắt đầu lại từ 000001 |
| H03 | Tạo đồng thời nhiều chứng từ cùng loại | Không trùng số |
| H04 | Hủy chứng từ | Số giữ nguyên, không tái sử dụng; chấp nhận khoảng trống |
| H05 | Xóa chứng từ (kể cả `DRAFT`) | Không cho phép; chỉ Hủy |
| H06 | Sửa mã hoặc tên Product đã được dùng trên chứng từ | Chặn |
| H07 | Sửa mô tả hoặc trạng thái hoạt động của Product đã dùng | Cho phép; chứng từ cũ hiển thị mô tả mới |
| H08 | Xóa Product | Không cho phép |

## F. Điều kiện nghiệm thu tổng thể
- Không xuất âm tồn; không giữ chỗ âm; không nhập trùng PN+SN.
- Mọi biến động tồn phải truy về GR/GI Đã duyệt.
- Không được sử dụng lại quy tắc 'GIR bắt buộc dòng PO' trong hai luồng mới.
- Không vượt hạn mức GIR hàng bán theo dòng HĐ (luồng A và B dùng chung) và hạn mức dòng PR (luồng A, C); không tự suy ra dòng HĐ từ Product; lượng nhập không dùng làm hạn mức GIR; không xóa chứng từ; số chứng từ không trùng, không tái sử dụng.
- Quy tắc chưa chốt phải được xác nhận trước khi nghiệm thu các ca tương ứng.

## Quy ước thuật ngữ và tên bảng
PR = Purchase Requisition (`purchase_requisitions`); PO = Purchase Order (`purchase_orders`); GRR = Goods Receipt Request (`goods_receipt_requests`); GR = Goods Receipt (`goods_receipts`); GIR = Goods Issue Request (`goods_issue_requests`); GI = Goods Issue (`goods_issues`). Các bảng dòng dùng hậu tố `_lines`. Tham chiếu chi tiết xem `01-MVP-SCOPE.md`.
