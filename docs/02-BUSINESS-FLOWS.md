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
   - **PR mua để bán:** bắt đầu từ màn hình HĐ, chọn các dòng HĐ để map sang PR. Không có chức năng tách/nhân đôi dòng; mỗi dòng PR giữ đúng `sales_contract_line_id` gốc.
   - **PR mua vật tư/phụ kiện triển khai/dự phòng:** tạo trực tiếp từ màn hình PR, chọn HĐ và Product; dòng PR không bắt buộc `sales_contract_line_id` (§B1).
   - Không tự suy ra dòng HĐ từ Product; trùng Product không đồng nghĩa trùng dòng HĐ.
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

## B. GIR `SALES_CONTRACT` (Xuất theo HĐ) → GI
1. PM tạo GIR: chọn HĐ `ACTIVE`, kho dự kiến xuất và các dòng HĐ (dòng hàng bán) hoặc vật tư trong kho (dòng vật tư, §B1).
2. Mỗi dòng GIR hàng bán tham chiếu `sales_contract_line_id` và một Product. PM có thể lưu `DRAFT` với Product đã chuẩn hóa nhưng chưa được Sales xác nhận cho dòng HĐ; **Gửi duyệt bị chặn** cho đến khi Sales xác nhận. Sau khi Sales xác nhận, PM chủ động Gửi duyệt (không tự động).
2a. Dòng GIR vật tư triển khai: chọn vật tư trong kho, không tham chiếu dòng HĐ, không cần Sales xác nhận Product, không bắt buộc vật tư được mua từ PR của HĐ đó (§B1).
3. Số lượng đề nghị của dòng hàng bán không vượt hạn mức còn lại của dòng HĐ (03 §10.1); UI hiển thị số lượng HĐ, số lượng đã đề nghị ở GIR khác, số lượng còn được đề nghị.
4. Có thể lập và duyệt GIR khi hàng chưa về kho. Phê duyệt một cấp.
5. Quản lý kho lập GI: chọn dòng GIR cần xuất và số lượng; kiểm tra tồn khả dụng theo Kho + PN, không bắt buộc hàng nhập từ PR/PO/HĐ tương ứng.
6. Với PN quản lý SN, chọn đúng số SN khả dụng; Gửi duyệt GI giữ chỗ; Duyệt GI trừ tồn thực tế.
7. Nhiều GI có thể xuất từng phần của một GIR. Quản lý kho "Xác nhận hoàn thành xuất" (từ màn hình GI, hiệu lực cho cả GIR) → GIR `COMPLETED`, giải phóng phần chưa xuất khỏi hạn mức HĐ (03 §10.3).

## B1. Vật tư/phụ kiện triển khai theo HĐ (ADR-0012)
1. Mua: tạo PR trực tiếp từ màn hình PR, chọn HĐ `ACTIVE` và Product; dòng PR không có `sales_contract_line_id`. PO → GRR → GR như §A.3–9.
2. Xuất: tạo GIR, chọn HĐ `ACTIVE` và vật tư trong kho; dòng GIR không có `sales_contract_line_id`. Vật tư có thể đến từ bất kỳ nguồn nhập nào tại Kho + PN (như §D).
3. Dòng vật tư không chiếm hạn mức dòng HĐ và không phụ thuộc Product được Sales xác nhận. Phê duyệt, kho, SN, GI và hoàn thành xuất giữ nguyên.
4. Loại GIR (`SALES_CONTRACT`/`AVAILABLE_STOCK`) áp dụng cho dòng vật tư, giới hạn số lượng dòng vật tư và việc trộn hai loại dòng trên cùng chứng từ: **chưa chốt** (OPEN-QUESTIONS CM1–CM3).

## C. GIR `AVAILABLE_STOCK` (Xuất hàng có sẵn) → GI
1. Dùng hàng có sẵn trong kho hợp lệ để phục vụ HĐ — **vẫn bắt buộc HĐ `ACTIVE`; dòng hàng bán bắt buộc dòng HĐ**; không bắt buộc PR/PO. Dòng vật tư trên `AVAILABLE_STOCK`: chưa chốt (CM1).
2. Chỉ chọn kho được cấu hình cho phép (`allow_available_stock_issue`). Ví dụ hợp lệ: kho hàng thừa chờ bán; không hợp lệ: kho dự án. Kho hàng hỏng còn bảo hành: chưa xác nhận.
3. UI hiển thị tồn khả dụng theo Product và kho nguồn. Số lượng tối đa = min(hạn mức dòng HĐ còn lại, tồn khả dụng của Product tại kho). GIR không giữ chỗ tồn.
4. Điều kiện Product được Sales xác nhận cho dòng HĐ như §B.2.
5. **Hai bước duyệt tuần tự** (ngoại lệ): Sales phụ trách hàng hóa xác nhận quyền dùng nguồn hàng → Quản lý kho duyệt GIR và khả năng đáp ứng. GIR chỉ `APPROVED` sau bước Quản lý kho. Tồn được kiểm tra lại khi duyệt.
6. GIR đã Gửi duyệt không sửa trực tiếp; muốn sửa (kể cả giảm số lượng) phải Thu hồi về `DRAFT`, sửa, Gửi duyệt lại và duyệt lại từ bước Sales.
7. GI và hoàn thành xuất như §B.5–7.

## D. Dùng chung hàng tồn giữa các khách hàng
Ví dụ: PN-X nhập từ PR/HĐ của khách A vào kho HCM, nhưng GI cho HĐ của khách B vẫn có thể chọn PN-X/SN đó nếu khả dụng. Lịch sử SN phải thể hiện nguồn nhập thực tế và nguồn xuất riêng biệt.

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
