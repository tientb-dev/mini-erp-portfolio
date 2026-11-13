# Mini ERP MVP — Kịch bản nghiệm thu nghiệp vụ
**Trạng thái:** MVP baseline (2026-11-13). Thay đổi tiếp theo phải ghi nhận qua ADR/OPEN-QUESTIONS.

## A. HĐ / PR / PO
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| A01 | Một HĐ `ACTIVE` tạo PR-1 và PR-2 | Cả hai PR cùng tham chiếu HĐ, mỗi PR chỉ một HĐ; dòng PR tham chiếu dòng HĐ |
| A02 | PO gom dòng từ hai PR khác HĐ nhưng cùng nhà cung cấp | Cho phép; từng dòng giữ nguồn PR |
| A03 | PO chứa dòng từ hai nhà cung cấp | Không cho phép |
| A04 | Tổng PO Chờ duyệt + Đã duyệt vượt lượng dòng PR | Chặn Gửi duyệt |
| A05 | PR dùng hai dòng cùng PN | Cho phép, hai dòng là hai nhu cầu riêng |
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
| A28a | Dòng PR tham chiếu `sales_contract_line_id` của HĐ `ACTIVE` | Bắt buộc; snapshot yêu cầu ban đầu được lưu |
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
| C04 | Tổng GIR (`DRAFT`/`WAITING_FOR_APPROVE`/`APPROVED`/`REJECTED`) trên một dòng HĐ vượt số lượng dòng HĐ | Chặn khi tạo/sửa/Gửi duyệt/Duyệt |
| C05 | GIR `CANCELED` | Không chiếm hạn mức dòng HĐ |
| C06 | Hai dòng HĐ cùng PN | Hạn mức tính riêng theo `sales_contract_line_id`, không cộng gộp |
| C07 | Hai GIR tạo đồng thời trên cùng dòng HĐ, tổng vượt hạn mức | Chỉ một thành công |
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

## D. GIR hàng có sẵn / GI
| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| D01 | GIR `AVAILABLE_STOCK` không chọn HĐ hoặc dòng HĐ | Không cho phép (bắt buộc HĐ `ACTIVE` và dòng HĐ); không cần PR/PO |
| D02 | Kho HCM có PN-A, kho HN không có | Chỉ chọn PN-A cho loại hàng có sẵn tại HCM |
| D12 | GIR `AVAILABLE_STOCK` chọn kho không có `allow_available_stock_issue` (vd. kho dự án) | Không cho phép |
| D13 | Hạn mức dòng HĐ còn 8, tồn khả dụng 5 | Số lượng tối đa 5; UI chặn vượt; backend chặn khi lưu/Gửi duyệt |
| D14 | Tồn khả dụng giảm còn 3 trong khi GIR 5 đang chờ duyệt | Không duyệt được |
| D15 | Sales xác nhận GIR `AVAILABLE_STOCK` | Chưa `APPROVED`; chuyển sang bước Quản lý kho |
| D16 | Quản lý kho duyệt sau Sales | GIR `APPROVED` |
| D17 | Quản lý kho duyệt khi Sales chưa xác nhận | Không cho phép |
| D18 | GIR `AVAILABLE_STOCK` `APPROVED` thu hồi, giảm số lượng, Gửi duyệt lại | Duyệt lại từ bước Sales; xác nhận cũ hết hiệu lực |
| D19 | GIR `AVAILABLE_STOCK` | Không giữ chỗ tồn; chỉ GI Chờ duyệt giữ chỗ |
| D20 | Sales hoặc Quản lý kho từ chối GIR `AVAILABLE_STOCK` | GIR `REJECTED`; PM nhận thông báo; muốn tiếp tục phải Thu hồi/sửa và duyệt lại từ bước Sales |
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
| E03 | Tìm SN đã xuất | Thấy GR, GRR, PO, PR nhập; GIR, GI xuất và HĐ của GIR (mọi GIR đều gắn HĐ) |
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
| G12 | Sales thu hồi xác nhận Product đang được GIR chưa `CANCELED` dùng | Chặn |
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
- Không vượt hạn mức GIR theo dòng HĐ; không xóa chứng từ; số chứng từ không trùng, không tái sử dụng.
- Quy tắc chưa chốt phải được xác nhận trước khi nghiệm thu các ca tương ứng.

## Quy ước thuật ngữ và tên bảng
PR = Purchase Requisition (`purchase_requisitions`); PO = Purchase Order (`purchase_orders`); GRR = Goods Receipt Request (`goods_receipt_requests`); GR = Goods Receipt (`goods_receipts`); GIR = Goods Issue Request (`goods_issue_requests`); GI = Goods Issue (`goods_issues`). Các bảng dòng dùng hậu tố `_lines`. Tham chiếu chi tiết xem `01-MVP-SCOPE.md`.
