# Mini ERP MVP — Luồng nghiệp vụ
**Trạng thái:** MVP baseline (2026-11-13). Thay đổi tiếp theo phải ghi nhận qua ADR/OPEN-QUESTIONS.

## 0. HĐ bán và Product được phép giao
1. Sales tạo HĐ (`DRAFT`), nhập khách hàng và các dòng HĐ. Mỗi dòng HĐ có ID riêng và lưu nguyên thông tin hàng hóa khách hàng ký (mã/tên có thể chưa chuẩn hóa, UoM, số lượng); không bắt buộc có Product chính thức.
2. Sales chốt HĐ: `DRAFT` → `ACTIVE`. Không có workflow phê duyệt HĐ. HĐ `ACTIVE` khóa nội dung nghiệp vụ.
3. Chỉ HĐ `ACTIVE` được tham chiếu khi tạo PR/GIR.
4. PM đề xuất Product chính thức (kể cả hàng thay thế) cho từng dòng HĐ, kèm lý do. Sales xác nhận hoặc từ chối theo thỏa thuận với khách hàng; hệ thống lưu người xác nhận, thời điểm, ghi chú hoặc số phụ lục. Một dòng HĐ có thể có nhiều Product được xác nhận.
5. Hủy HĐ (`CANCELED`) phải kiểm tra chứng từ phụ thuộc (03 §9).

## A. HĐ → PR → PO → GRR → GR
1. HĐ `ACTIVE` là nguồn của PR (xem §0).
2. Khi lập PR, chọn đúng **một HĐ** `ACTIVE` (gắn ở cấp chứng từ). Có thể có nhiều PR cho một HĐ. Mỗi dòng PR giữ snapshot yêu cầu ban đầu; PR có thể có nhiều dòng, kể cả lặp mã cho nhu cầu khác nhau. Hai cách lập (ADR-0012):
   - **PR hàng bán:** bắt đầu từ màn hình HĐ; hệ thống copy toàn bộ dòng hàng và thông tin liên quan sang form để người dùng chỉnh sửa trước khi lưu. Mỗi dòng PR giữ đúng `sales_contract_line_id`; không gộp các dòng HĐ cùng Product; trong cùng PR không chia/tạo trùng một dòng HĐ. Nhiều PR khác nhau được tham chiếu cùng dòng HĐ.
   - **PR vật tư** (vật tư/phụ kiện triển khai, dự phòng): tạo tại màn hình PR, chọn HĐ rồi tự chọn vật tư (được dùng mã tạm, mapping trước khi nhập kho theo §A.4–5); dòng PR không bắt buộc `sales_contract_line_id`.
   - Phân loại dòng tường minh; MVP không trộn hàng bán và vật tư trong một PR. Không tự suy ra dòng HĐ từ Product; trùng Product không đồng nghĩa trùng dòng HĐ.
2a. Dòng PR chọn **mã tạm** (`temporary_products`, kèm chọn UoM từ dropdown) hoặc **mã chính** (`products`, UoM lấy từ danh mục). Dòng PR lưu snapshot mã, tên, mô tả, UoM ban đầu.
3. Chọn dòng từ nhiều PR để lập PO của **một nhà cung cấp**. Mỗi dòng PO giữ liên kết đến đúng một dòng PR; có thể chia một dòng PR qua nhiều dòng/PO.
4. Mã tạm được ánh xạ (mapping) sang mã chính **một lần duy nhất**, theo từng dòng PR, trực tiếp trên PO hoặc GRR đang `DRAFT`; kết quả ghi vào `purchase_requisition_lines.product_id` và dùng chung cho mọi PO/GRR tham chiếu dòng PR đó, kể cả chứng từ đã duyệt. Không đổi lần hai; không đổi mã chính sang mã chính khác. Dòng PO kế thừa UoM snapshot của dòng PR. Mapping bị chặn nếu UoM mã chính khác UoM dòng PR hoặc bất kỳ dòng PO liên quan; không quy đổi UoM/số lượng. Chi tiết 03 §1a. Mapping PR → Product (chuẩn hóa hàng mua) **tách biệt** với xác nhận Product cho dòng HĐ (§0.4).
5. Từ PO Đã duyệt, lập nhiều GRR cho các đợt nhập, mỗi GRR một PO và một kho; dòng GRR kế thừa UoM dòng PO. Không vượt hạn mức số lượng PO. GRR Nháp được giữ mã tạm; Gửi duyệt yêu cầu mọi dòng có mã chính và UoM dòng GRR trùng UoM mã chính. Điều chỉnh PO là nghiệp vụ ngoài MVP.
6. Từ GRR Đã duyệt, tạo GR kế thừa nguyên dòng, PN, số lượng, kho. Người có quyền khai báo kho nhập chi tiết hàng.
7. Hàng quản lý SN: mỗi đơn vị một dòng chi tiết (`goods_receipt_details`, số lượng 1) và SN duy nhất; hàng không quản lý SN: một dòng chi tiết mang toàn bộ số lượng.
8. GR Nháp có thể thiếu SN; Gửi duyệt yêu cầu đủ và hợp lệ; GR Chờ duyệt không giữ chỗ SN. Duyệt GR kiểm tra lại SN chưa từng nhập kho, rồi mới tăng tồn thực tế và tạo SN tồn kho.
8a. GR Nháp/Bị từ chối có thể Hủy; GRR khi đó được tạo GR mới.
8b. GR Đã duyệt có thể được người tạo Thu hồi về Nháp nếu không SN nào còn được GI chưa Hủy tham chiếu và số lượng không-SN đủ hoàn tác (chi tiết 03 §2.2); tồn kho được hoàn tác, sau đó sửa và duyệt lại.
9. PO hiển thị tiến độ nhập: Chưa nhập / Nhập một phần / Đã nhập đủ; số lượng thực nhập lấy từ GR Đã duyệt. Trạng thái này độc lập trạng thái duyệt PO.

## B. Bốn luồng GIR → GI (ADR-0012)
| Luồng | Phân loại | Nguồn (`issue_type`) | Hạn mức |
|---|---|---|---|
| A. Hàng bán theo PR | Hàng bán | PR đã `PO done` (`SALES_CONTRACT`) | dòng PR **và** hạn mức giao dòng HĐ |
| B. Hàng bán trực tiếp | Hàng bán | `AVAILABLE_STOCK` | hạn mức giao dòng HĐ; tồn khả dụng của người phụ trách |
| C. Vật tư theo PR | Vật tư | PR đã `PO done` (`SALES_CONTRACT`) | dòng PR |
| D. Vật tư trực tiếp | Vật tư | `AVAILABLE_STOCK` | tồn khả dụng của người phụ trách; không áp hạn mức PR/HĐ |

Chung: PM tạo GIR, chọn HĐ `ACTIVE` và một kho; một GIR chỉ một phân loại (không trộn hàng bán và vật tư). Luồng A và B dùng chung hạn mức giao của dòng HĐ (03 §10.1), kể cả khi nhiều PR tham chiếu cùng dòng HĐ.

### B.1 Luồng A/C — theo PR
1. Chỉ PR đã `PO done` của HĐ xuất hiện để chọn. `PO done` không có nghĩa là đã nhập kho; có thể lập và duyệt GIR khi hàng chưa về.
2. Mỗi dòng GIR tham chiếu đúng một dòng PR (giữ riêng từng dòng PR, không gộp theo Product); dòng hàng bán đồng thời giữ `sales_contract_line_id` của dòng PR.
3. Số lượng đề nghị không vượt hạn mức còn lại của dòng PR; luồng A còn không vượt hạn mức giao còn lại của dòng HĐ.
4. UI hiển thị lượng đã nhập thực tế của dòng PR (dòng PR → PO → GRR → GR `APPROVED`, cộng nhiều đợt nhập; chưa nhập = 0). Chỉ để tham khảo, không phải hạn mức.
5. Luồng A: Product phải được Sales xác nhận cho dòng HĐ trước khi Gửi duyệt (như §B.3). Phê duyệt một cấp.

### B.2 Luồng B/D — trực tiếp từ tồn kho (`AVAILABLE_STOCK`)
1. Không cần PR. Chọn tồn theo **Kho → Người phụ trách nguồn hàng → Product**; một GIR chỉ một kho và một người phụ trách, được chọn nhiều Product của người đó. Kho hoặc người phụ trách khác → GIR khác.
2. Chỉ chọn kho có `allow_available_stock_issue`. Ví dụ hợp lệ: kho hàng thừa chờ bán; không hợp lệ: kho dự án, kho bảo hành/hàng hỏng.
3. UI hiển thị tồn khả dụng theo kho, người phụ trách và Product. Luồng B: số lượng ≤ min(hạn mức giao dòng HĐ còn lại, tồn khả dụng); luồng D: ≤ tồn khả dụng. GIR không giữ chỗ tồn.
4. Luồng B: bắt buộc dòng HĐ và Product được Sales xác nhận (§B.3). Luồng D: không cần PR hay dòng HĐ, **bắt buộc ghi mục đích sử dụng**.
5. **Hai bước duyệt tuần tự** (ngoại lệ): người phụ trách nguồn hàng đồng ý → Quản lý kho duyệt. Người phụ trách nguồn hàng có thể khác Sales của HĐ nhận hàng. GIR chỉ `APPROVED` sau bước Quản lý kho; tồn được kiểm tra lại khi duyệt.
6. GIR đã Gửi duyệt không sửa trực tiếp; muốn sửa (kể cả giảm số lượng) phải Thu hồi về `DRAFT`, sửa, Gửi duyệt lại và duyệt lại từ bước người phụ trách nguồn hàng.

### B.3 Product được Sales xác nhận (hàng bán)
Dòng hàng bán (A, B) tham chiếu `sales_contract_line_id` và một Product. PM có thể lưu `DRAFT` với Product chưa được Sales xác nhận cho dòng HĐ; **Gửi duyệt bị chặn** cho đến khi Sales xác nhận; sau đó PM chủ động Gửi duyệt (không tự động). UI hiển thị số lượng HĐ, đã đề nghị ở GIR khác, còn được đề nghị. Dòng vật tư (C, D) không áp dụng.

### B.4 GI và hoàn thành xuất (mọi luồng)
1. Quản lý kho lập GI: chọn dòng GIR cần xuất và số lượng; kiểm tra tồn khả dụng tại GI theo quy trình hiện có (03 §4). Nguồn tồn khi xuất cho luồng A/C và cơ chế phân bổ theo người phụ trách/dòng GR: chưa chốt (OPEN-QUESTIONS).
2. Với PN quản lý SN, chọn đúng số SN khả dụng; Gửi duyệt GI giữ chỗ; Duyệt GI trừ tồn thực tế.
3. Nhiều GI có thể xuất từng phần của một GIR. Quản lý kho "Xác nhận hoàn thành xuất" (từ màn hình GI, hiệu lực cho cả GIR) → GIR `COMPLETED`, giải phóng phần chưa xuất khỏi hạn mức (03 §10.3).

## D. Dùng chung hàng tồn giữa các khách hàng
Ví dụ: PN-X nhập từ PR/HĐ của khách A vào kho HCM, nhưng GI cho HĐ của khách B vẫn có thể chọn PN-X/SN đó nếu khả dụng. Với GIR `AVAILABLE_STOCK`, việc dùng hàng của người phụ trách nguồn hàng khác cần người đó đồng ý (§B.2). Lịch sử SN phải thể hiện nguồn nhập thực tế và nguồn xuất riêng biệt.

## E. Lịch sử SN
- Tìm theo SN (không phân biệt hoa thường, bỏ khoảng trắng đầu/cuối); khi SN trùng giữa PN khác nhau phải phân biệt theo PN.
- Nguồn nhập: PR → PO → GRR → GR → SN; kèm kho, vị trí lịch sử, bảo hành nếu có.
- Nguồn xuất: GIR → GI → HĐ (cả hai loại GIR đều gắn HĐ ở cấp chứng từ; dòng hàng bán thêm dòng HĐ).
- Không còn mặc định 'PO yêu cầu xuất' ở hai loại GIR; PO nhập vẫn được truy xuất.
- Chỉ hiển thị SN thuộc phạm vi kho được phép xem tồn kho.
- MVP chỉ hiển thị lịch sử Inventory còn hiệu lực; lần nhập đã bị Thu hồi GR không xuất hiện ở lịch sử SN (lịch sử Duyệt/Thu hồi xem ở GR).

## F. Giao diện chứng từ
Mọi chứng từ dùng cùng cấu trúc tab: **Thông tin chung**, **Người phê duyệt**, **Hồ sơ đính kèm**, **Ghi chú**. GR có thêm tab **Chi tiết hàng nhập kho** (SN và thông tin nhập thực tế). MVP chỉ cần file đính kèm và ghi chú cơ bản.

## Quy ước thuật ngữ và tên bảng
HĐ = Sales Contract (`sales_contracts`); PR = Purchase Requisition (`purchase_requisitions`); PO = Purchase Order (`purchase_orders`); GRR = Goods Receipt Request (`goods_receipt_requests`); GR = Goods Receipt (`goods_receipts`); GIR = Goods Issue Request (`goods_issue_requests`); GI = Goods Issue (`goods_issues`). Các bảng dòng dùng hậu tố `_lines`. Tham chiếu chi tiết xem `01-MVP-SCOPE.md`.
