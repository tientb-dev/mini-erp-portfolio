# Mini ERP MVP — Quy tắc nghiệp vụ
**Trạng thái:** MVP baseline (2026-11-13). Thay đổi tiếp theo phải ghi nhận qua ADR/OPEN-QUESTIONS.

## 1. Số lượng và liên kết mua hàng — đã chốt
- Mỗi PR thuộc một HĐ `ACTIVE` (cấp chứng từ); mỗi dòng PR giữ snapshot yêu cầu ban đầu; có nhiều dòng và có thể lặp PN/mã tạm.
- **Phân loại dòng** (đã chốt 2026-11-13, ADR-0012): mỗi dòng PR có phân loại tường minh hàng bán/vật tư; MVP không trộn hai loại trong một PR.
- **PR hàng bán:** tạo từ màn hình HĐ; copy toàn bộ dòng hàng và thông tin liên quan sang form để chỉnh sửa trước khi lưu. Mỗi dòng PR giữ đúng `sales_contract_line_id`; dòng HĐ phải thuộc HĐ của PR; không gộp dòng HĐ cùng Product. Trong cùng PR không chia/tạo trùng một dòng HĐ; nhiều PR khác nhau được tham chiếu cùng dòng HĐ. Không có hạn mức Σ PR ≤ dòng HĐ (IM19).
- **PR vật tư** (vật tư/phụ kiện triển khai/dự phòng): tạo tại màn hình PR, chọn HĐ rồi tự chọn vật tư; `sales_contract_line_id` không bắt buộc; được dùng mã tạm theo §1a (chuẩn hóa trước khi nhập kho).
- Trùng Product không đồng nghĩa trùng dòng HĐ; hệ thống không tự suy ra hoặc tự gán `sales_contract_line_id` theo Product.
- PO có một nhà cung cấp; dòng PO tham chiếu một dòng PR; không gộp các dòng PR.
- Tổng số lượng dòng PO Chờ duyệt + Đã duyệt gắn với dòng PR không vượt số lượng PR Đã duyệt.
- Một GRR tham chiếu một PO Đã duyệt, một kho; mỗi dòng GRR tham chiếu một dòng PO.
- Tổng số lượng GRR Chờ duyệt + Đã duyệt theo dòng PO không vượt số lượng PO Đã duyệt.
- GRR có thể chọn một phần dòng/số lượng của PO; không tự tăng vượt hạn mức.
- PO có tiến độ nhập thực tế dựa trên GR Đã duyệt, tách khỏi trạng thái phê duyệt.

## 1a. Danh mục hàng hóa, mã tạm và mapping — đã chốt (2026-11-13)
- Danh mục hàng hóa gồm `temporary_products` (mã tạm: mã, tên, mô tả; không UoM) và `products` (mã chính: UoM, `is_serial_tracked`, thông tin kế toán dự trù).
- Dòng PR (`purchase_requisition_lines`): snapshot mã, tên, mô tả, UoM ban đầu. Chọn mã tạm → bắt buộc chọn UoM từ dropdown; chọn mã chính → UoM lấy từ `products`. `purchase_requisition_lines.product_id` nullable là kết quả chuẩn hóa dùng chung.
- **Mapping** chỉ theo chiều mã tạm → mã chính, ghi vào `purchase_requisition_lines.product_id`. **Không cho đổi lần hai**; không đổi mã chính sang mã chính khác.
- Mapping thực hiện trực tiếp trên PO hoặc GRR **chỉ khi chứng từ đó ở `DRAFT`** và dòng PR chưa có mã chính. Dùng quyền sửa chứng từ tương ứng (không có mã quyền riêng); không có thông báo riêng.
- Mapping theo **từng dòng PR**; không tự áp dụng cho các dòng khác cùng mã tạm. Mã tạm vẫn được tái sử dụng sau mapping.
- Mọi PO/GRR cùng tham chiếu một dòng PR dùng chung kết quả mapping, kể cả chứng từ đã duyệt. **Ngoại lệ có chủ đích:** thông tin hàng hóa hiển thị trên chứng từ Đã duyệt có thể thay đổi do mapping dùng chung; không được sửa trực tiếp số lượng hay nội dung đã duyệt; snapshot ban đầu trên dòng PR không đổi.
- Mapping phải an toàn đồng thời: hai người mapping cùng dòng PR → chỉ một thành công, người còn lại nhận lỗi rõ ràng.
- **Không hỗ trợ quy đổi UoM trong MVP.** Mapping và mọi thao tác khác không bao giờ tự đổi UoM hay số lượng.
- **Kế thừa UoM:** dòng PO kế thừa UoM snapshot của dòng PR khi tạo và lưu UoM riêng; dòng GRR kế thừa UoM của dòng PO.
- Hạn mức Σ PO ≤ PR và Σ GRR ≤ PO chỉ so sánh số lượng cùng UoM.
- **Chặn mapping** nếu UoM mã chính khác UoM snapshot của dòng PR **hoặc** UoM của bất kỳ dòng PO nào tham chiếu dòng PR đó (mọi trạng thái, kể cả `APPROVED`). Kiểm tra ở backend, trong cùng transaction với cập nhật `product_id`.
- GRR **không được Gửi duyệt** nếu UoM dòng GRR khác UoM hiện hành của mã chính; không có cơ chế xác nhận để vượt qua. Backend kiểm tra từng dòng GRR.
- Điều chỉnh PO (đổi UoM/số lượng PO đã duyệt) và quy đổi UoM: **ngoài MVP**.
- GRR Nháp được giữ mã tạm; **tất cả dòng GRR phải có mã chính trước Gửi duyệt**. GR, GIR, GI và Inventory chỉ dùng mã chính.
- Dòng HĐ **không bắt buộc** có mã chính (thay thế quy tắc T3 cũ "dòng HĐ chỉ dùng mã chính"); Product được phép giao của dòng HĐ quản lý riêng (§9.2).
- Mã tạm không có bản dịch trong MVP.
- Auto Mapping hàng loạt: ngoài MVP.

**Lỗi nghiệp vụ (mã trả về):**
| Tình huống | Mã lỗi |
|---|---|
| Mapping khi PO/GRR không ở `DRAFT` | `DOCUMENT_NOT_DRAFT` |
| Mapping dòng PR đã có mã chính / mapping đồng thời thua | `PRODUCT_ALREADY_MAPPED` |
| Mapping sang mã chính khác UoM dòng PR hoặc dòng PO liên quan | `MAPPING_UOM_MISMATCH` |
| Gửi duyệt GRR còn dòng mã tạm | `GRR_LINE_NOT_MAPPED` |
| Gửi duyệt GRR có dòng UoM ≠ UoM mã chính | `GRR_LINE_UOM_MISMATCH` |
| Đổi `is_serial_tracked` của PN đã khóa | `SERIAL_TRACKING_LOCKED` |
| Đổi UoM của mã chính đã khóa (§1c) | `PRODUCT_UOM_LOCKED` |

## 1b. Cờ SN của mã chính — đã chốt (2026-11-13)
- `products.is_serial_tracked` mặc định `true`.
- Khóa thay đổi nếu PN từng xuất hiện trên GRR, GR, GIR hoặc GI, **bất kể trạng thái** (kể cả `DRAFT`, `CANCELED`).

## 1c. UoM của mã chính — đã chốt (2026-11-13)
- Khóa thay đổi `products.unit_of_measure_id` khi mã chính đã xuất hiện trên PR, PO, GRR, GR, HĐ bán hàng, GIR hoặc GI, **bất kể trạng thái** (kể cả `DRAFT`, `CANCELED`). Với HĐ: dòng HĐ không bắt buộc mã chính, nên "xuất hiện trên HĐ" được hiểu qua liên kết Product ↔ dòng HĐ (§9.2) — đề xuất chưa `APPROVED` không tính (H5).
- **Mở rộng (2026-11-13, M2):** sau khi Product đã được sử dụng trong chứng từ, khóa cả **mã hàng** và **tên hàng** (cùng phạm vi trên). Mô tả Product vẫn được sửa; trạng thái hoạt động được đổi; không xóa Product. Tên dịch (`product_translations`) bị khóa cùng tên.
- HĐ và PR giữ thông tin hàng hóa gốc độc lập với Product. PO/GRR/GR/GIR/GI tham chiếu `product_id`, không snapshot tên/mô tả trong MVP; mô tả hiển thị trên chứng từ cũ có thể là mô tả mới nhất.
- Dòng PR dùng mã tạm chỉ được tính là "xuất hiện" sau khi đã mapping sang mã chính đó.
- Backend bắt buộc kiểm tra; vi phạm trả `PRODUCT_UOM_LOCKED`.
- Sửa UoM và mapping/thêm mã chính vào chứng từ không được chạy chen nhau làm mất hiệu lực kiểm tra (cơ chế: ADR-0008).

## 2. GR và chi tiết — đã chốt
- Một GRR Đã duyệt có tối đa một GR không Hủy; có thể tạo GR thay thế nếu GR cũ đã Hủy.
- GR kế thừa toàn bộ dòng, PN, số lượng và kho từ GRR, không tự chỉnh số lượng.
- PN quản lý SN: N đơn vị = N dòng chi tiết, mỗi dòng số lượng 1, SN bắt buộc khi Gửi duyệt.
- PN không quản lý SN: một dòng chi tiết với số lượng kế thừa, không có SN.
- Vị trí lưu và thông tin bảo hành là tùy chọn; vị trí chỉ mang tính lịch sử, không quản lý tồn theo vị trí.
- Người có quyền khai báo chi tiết tại kho được chỉnh GR Nháp/Bị từ chối dù không phải người tạo. Người tạo chịu trách nhiệm Gửi duyệt.
- SN duy nhất toàn lịch sử theo PN+SN sau chuẩn hóa (trim hai đầu, không phân biệt hoa thường), kể cả khi SN đã xuất.
- Ba cấp dữ liệu: dòng GRR (`goods_receipt_request_lines`) → dòng GR kế thừa (`goods_receipt_lines`) → chi tiết rã từ từng dòng GR (`goods_receipt_details`). SN khai báo tại `goods_receipt_details`.
- `goods_receipt_details` là dữ liệu chứng từ, độc lập với Inventory; không bị xóa khi Thu hồi hoặc Hủy GR.
- **Không giữ chỗ SN ở GR Chờ duyệt.** Hai GR chưa Đã duyệt có thể khai báo trùng SN.
- Kiểm tra Gửi duyệt GR là toàn bộ chứng từ; thiếu SN, SN trùng trong cùng chứng từ hoặc trùng SN đã ghi nhận nhập kho thì chặn.
- Trùng SN với GR Chờ duyệt khác **không** chặn Gửi duyệt.
- **Duyệt GR** kiểm tra lại toàn bộ: PN + normalized SN hợp lệ và chưa từng được ghi nhận nhập kho; nếu không hợp lệ/trùng thì chặn Duyệt nguyên chứng từ và trả lỗi rõ ràng; GR **giữ nguyên Chờ duyệt** để người duyệt có thể Từ chối. Phải an toàn khi hai GR được duyệt đồng thời.
- Chỉ GR **Đã duyệt** tác động Inventory (tăng tồn, ghi biến động nhập, tạo SN và lịch sử SN) trong cùng một thao tác nhất quán. GR Nháp/Chờ duyệt/Bị từ chối/Đã hủy không tác động Inventory.
- SN đã từng được ghi nhận nhập kho (kể cả đã xuất) không được dùng lại như SN mới.
- Chặn lưu đè khi dữ liệu người dùng đang sửa đã cũ.

### 2.1 Hủy GR — đã chốt
- Nháp → Đã hủy và Bị từ chối → Đã hủy: được phép.
- Chờ duyệt: phải Thu hồi trước khi Hủy. Đã duyệt: không Hủy trực tiếp.
- Đã hủy là trạng thái kết thúc: không sửa, không Gửi duyệt lại.
- Hủy chỉ đổi trạng thái, không xóa dữ liệu GR. GR chưa từng Đã duyệt khi Hủy không tác động Inventory.
- Khi GR đã Hủy, GRR được tạo GR mới nếu vẫn đáp ứng điều kiện (tối đa một GR chưa Hủy).

### 2.2 Thu hồi GR — đã chốt
- **Chờ duyệt → Nháp:** không tác động Inventory; sau đó có thể sửa, Gửi duyệt lại hoặc Hủy.
- **Đã duyệt → Nháp:** được phép khi toàn bộ tác động tồn kho của lần duyệt đó còn hoàn tác được:
  - PN có SN: không SN nào của GR còn được tham chiếu bởi GI chưa Hủy (Nháp, Chờ duyệt, Bị từ chối, Đã duyệt). Hệ thống không tự gỡ SN khỏi GI; tham chiếu đã được gỡ hợp lệ hoặc GI đã Hủy thì không còn chặn. Dòng SN trên GI đã Hủy được giữ nguyên để truy vết.
  - PN không SN: sau hoàn tác, tồn thực tế theo Kho + PN không âm và không thấp hơn lượng GI Chờ duyệt đang giữ chỗ.
  - Một dòng hoặc một SN không đạt → từ chối Thu hồi **toàn bộ** GR, không hoàn tác một phần.
- Thu hồi Đã duyệt thành công: hoàn tác toàn bộ tác động tồn kho của lần duyệt đó (Inventory hiện hành không còn thể hiện hàng đã thu hồi); giữ nguyên `goods_receipt_details`; tiến độ nhập PO được tính lại; GR được sửa và duyệt lại theo workflow. Lần duyệt mới ghi nhận Inventory theo dữ liệu GR tại thời điểm đó.
- Kiểm tra và cập nhật trong cùng một thao tác nhất quán, có khóa phù hợp để tránh tranh chấp với GI.
- Lịch sử Duyệt/Thu hồi phải được lưu ở cấp chứng từ để audit. Inventory chỉ giữ dữ liệu của lần duyệt còn hiệu lực (không có reversal ledger trong MVP).
- Người tạo GR thực hiện Thu hồi khi thỏa quyền và điều kiện; cần lý do (theo §6).

## 3. GIR: hai loại nguồn, bốn luồng — đã chốt (cập nhật 2026-11-13, ADR-0012)
- **Mọi GIR bắt buộc HĐ `ACTIVE` ở cấp chứng từ** và một kho. Mỗi dòng GIR có phân loại tường minh hàng bán/vật tư; MVP không trộn hai loại trong một GIR.
- Bốn luồng:
  - **A. Hàng bán theo PR**: nguồn là dòng PR hàng bán thuộc PR đã `PO done`; giữ riêng từng dòng PR; kiểm soát hạn mức dòng PR và hạn mức giao còn lại của dòng HĐ.
  - **B. Hàng bán trực tiếp** (`AVAILABLE_STOCK`): không cần PR; bắt buộc dòng HĐ và Product được Sales xác nhận; kiểm soát hạn mức giao dòng HĐ.
  - **C. Vật tư theo PR**: nguồn là dòng PR vật tư thuộc PR đã `PO done`; giữ riêng từng dòng PR; kiểm soát hạn mức dòng PR; không áp hạn mức dòng HĐ. Mục đích sử dụng (đã chốt, CT9): chỉ tham khảo, có thể kế thừa từ PR, không bắt buộc nhập lại, không là điều kiện hạn mức hay phê duyệt.
  - **D. Vật tư trực tiếp** (`AVAILABLE_STOCK`): không cần PR/dòng HĐ; vẫn gắn HĐ; **bắt buộc ghi mục đích sử dụng**; không áp hạn mức PR/HĐ.
- **Hàng bán (A, B) dùng chung hạn mức giao của dòng HĐ** (§10.1), kể cả khi nhiều PR tham chiếu cùng dòng HĐ.
- **Hạn mức dòng PR (A, C):** Σ số lượng dòng GIR tham chiếu một dòng PR không vượt số lượng dòng PR Đã duyệt. Trạng thái chiếm hạn mức, thời điểm kiểm tra và đồng thời theo §10.1 (CT2).
- **`PO done`** (đã chốt 2026-11-13, CT1): một PR đạt `PO done` khi **mọi dòng PR** có tổng số lượng trên các dòng PO `APPROVED` (còn hiệu lực theo workflow) **bằng đúng** số lượng yêu cầu của dòng đó. Một dòng PR có thể mua qua nhiều PO; cộng dồn theo tham chiếu dòng PR, không theo Product; tổng đặt mua không vượt số lượng dòng PR (§1). Thiếu bất kỳ dòng nào → chưa `PO done`. `PO done` quyết định PR có hiển thị khi lập GIR theo PR và là điều kiện Gửi duyệt GIR A/C (xem quy tắc mất `PO done`); không có nghĩa là đã nhập kho; GIR A/C có thể lập và duyệt khi hàng chưa về.
- **Mất `PO done`** (đã chốt 2026-11-13): `PO done` là **điều kiện để Gửi duyệt** GIR A/C, kiểm tra tại backend ở mỗi lần Gửi duyệt (GIR `DRAFT`, và GIR `REJECTED` sửa rồi Gửi duyệt lại), không chỉ khi hiển thị danh sách PR. PR không còn `PO done` → chặn Gửi duyệt. GIR **đã Gửi duyệt hợp lệ** không bị tự động Hủy, Thu hồi hay đổi trạng thái khi PR mất `PO done` sau đó; tiếp tục theo workflow và hạn mức hiện hữu (không hồi tố). PR đạt lại `PO done` → được Gửi duyệt.
- **Lượng đã nhập tham khảo (A, C):** cộng số lượng GR `APPROVED` theo chuỗi dòng PR → dòng PO → dòng GRR → dòng GR; chưa nhập hiển thị 0. Không ghép theo Product; **không dùng làm hạn mức GIR**.
- Dòng hàng bán tham chiếu `sales_contract_line_id` và một Product. **Chặn Gửi duyệt** nếu Product chưa được Sales xác nhận cho dòng HĐ đó (§9.2); GIR `DRAFT` được lưu với Product chưa xác nhận. Sau khi Sales xác nhận, PM chủ động Gửi duyệt. Dòng vật tư không áp dụng điều kiện này và không chiếm hạn mức dòng HĐ.
- Không tự suy ra, tự gán hoặc tự gộp dòng HĐ/dòng PR theo Product.
- **Luồng theo PR (A, C):** phê duyệt một cấp (mặc định 03 §6); không áp dụng duyệt hai bước của `AVAILABLE_STOCK`. Giá trị `issue_type` cho luồng A/C: chưa chốt kỹ thuật (OPEN-QUESTIONS CT10).
- **`AVAILABLE_STOCK` (B, D):** dùng hàng có sẵn trong kho hợp lệ để phục vụ HĐ.
  - Chỉ chọn kho có `allow_available_stock_issue`. Kho hàng thừa chờ bán: hợp lệ; kho dự án, kho bảo hành/hàng hỏng: mặc định **không** hợp lệ.
  - Chọn tồn theo **Kho → Người phụ trách nguồn hàng → Product**. Một GIR chỉ một kho và một người phụ trách nguồn hàng; được nhiều Product của người đó. MVP không hỗ trợ nhiều kho trong một GIR hay nhóm kho.
  - Số lượng đề nghị ≤ tồn khả dụng của Product thuộc người phụ trách tại kho; luồng B còn ≤ hạn mức giao dòng HĐ còn lại. UI chặn vượt; backend kiểm tra khi lưu/Gửi duyệt và kiểm tra lại tồn khi duyệt; tồn không đủ → không duyệt.
  - **Hai bước duyệt tuần tự (ngoại lệ):** người phụ trách nguồn hàng đồng ý → Quản lý kho duyệt GIR và khả năng đáp ứng. GIR chỉ `APPROVED` sau bước Quản lý kho. Người phụ trách nguồn hàng có thể khác Sales của HĐ nhận hàng. Product, kho nguồn, số lượng là nội dung người phụ trách đã đồng ý.
  - Từ chối ở bước người phụ trách nguồn hàng hoặc Quản lý kho → GIR `REJECTED`, thông báo PM; muốn tiếp tục phải Thu hồi/sửa và duyệt lại từ bước đầu.
- **GIR không giữ chỗ Inventory**; GI giữ chỗ theo §4.
- GIR đã Gửi duyệt không sửa trực tiếp; sửa (kể cả chỉ giảm số lượng) phải Thu hồi về `DRAFT`, sửa, Gửi duyệt lại; với `AVAILABLE_STOCK` duyệt lại từ bước người phụ trách nguồn hàng.
- Một GIR có một kho; có thể có nhiều GI xuất từng đợt.
- Các quy tắc **GIR chọn dòng PO và hạn mức PO** kiểu cũ đã bị thay thế; hạn mức dòng PR của luồng A/C là quy tắc mới theo ADR-0012.
- **Phân biệt số lượng:** dòng HĐ, PR, PO, GR thực nhập, GIR đề nghị/được duyệt, GI thực xuất và tồn khả dụng là các đại lượng riêng; không dùng cái này thay cái khác. Tồn khả dụng được kiểm soát tại GI (§4).
- Hạn mức, hoàn thành xuất, thu hồi: §10.

## 4. GI — đã chốt
- Một GI lấy từ một GIR Đã duyệt, cùng kho; chọn một tập con dòng GIR, mỗi dòng GI tham chiếu một dòng GIR; không gộp.
- Số lượng xuất nguyên dương; được xuất một phần, nhiều GI cho cùng GIR.
- GI Chờ duyệt giữ chỗ số lượng và SN; GI Đã duyệt trừ tồn thực tế. Nháp/Bị từ chối không giữ chỗ.
- Tổng GI Chờ duyệt + Đã duyệt trên mỗi dòng GIR không vượt số lượng dòng GIR Đã duyệt.
- Khi thêm dòng GI, số lượng đề xuất không vượt phần GIR còn lại và tồn khả dụng. Nếu không còn thì không thêm mới.
- Dòng GI Nháp đã lưu được giữ nguyên nếu tồn thay đổi; cảnh báo, chặn Gửi duyệt khi thiếu.
- `goods_issue_serials` lưu thêm `serial_number` dạng snapshot chỉ để hiển thị lịch sử; không dùng cho Inventory hay kiểm tra khả dụng (quan hệ vẫn qua `goods_receipt_detail_id`).
- PN có SN: phải chọn đủ SN khả dụng tại đúng Kho + PN, không giới hạn PR/PO/HĐ nguồn nhập. SN chỉ khả dụng khi đang tồn tại và khả dụng trong tồn kho (từ GR Đã duyệt còn hiệu lực); SN chỉ có trên chi tiết GR chưa duyệt/đã thu hồi thì không được chọn. Kiểm tra và lưu SN phải an toàn khi đồng thời.
- SN có thể được nhập/tìm/scan; lựa chọn sai không làm mất SN đã chọn; chọn quá số lượng không hợp lệ; giảm số lượng dưới số SN đang chọn phải sửa trước khi Gửi duyệt.
- Gửi duyệt và Duyệt kiểm tra lại đồng thời số lượng, tồn và SN; xử lý nguyên chứng từ, không duyệt một phần.
- GI Đã duyệt bất biến, không Thu hồi/Hủy.

## 5. Tồn kho — đã chốt
- **Tồn thực tế** theo Kho + PN = tổng GR Đã duyệt − tổng GI Đã duyệt.
- **Tồn khả dụng** theo Kho + PN = tồn thực tế − số lượng GI Chờ duyệt giữ chỗ.
- Màn hình tồn kho phục vụ xem báo cáo; phép kiểm tồn khả dụng phục vụ lập/Gửi duyệt/Duyệt GI; không phải hai sổ tồn kho độc lập.
- SN khả dụng = SN thuộc GR Đã duyệt ở kho, chưa xuất qua GI Đã duyệt, chưa giữ chỗ bởi GI Chờ duyệt.
- Hàng tồn dùng chung giữa các HĐ, khách hàng và PR.
- **Người phụ trách nguồn hàng** (đã chốt 2026-11-13, ADR-0012): ghi nhận khi duyệt GR, thường là Sales phụ trách HĐ mà hàng được mua để phục vụ (không mặc định là Sales của HĐ nhận hàng). Tồn kho phải phân biệt được lượng theo người phụ trách, không chỉ theo Kho + PN; phục vụ chọn nguồn của GIR `AVAILABLE_STOCK`. Mô hình dữ liệu và cơ chế phân bổ xuất theo dòng GR/lô: chưa chốt kỹ thuật.
- Không quản lý tồn theo PO, PR, HĐ hay vị trí.

## 6. Vòng đời chứng từ — đã chốt chung
- Nháp → Chờ duyệt → Đã duyệt; Chờ duyệt có thể Bị từ chối hoặc được người tạo Thu hồi về Nháp. Thu hồi luôn đưa chứng từ về `DRAFT`; muốn tiếp tục phải Gửi duyệt và duyệt lại.
- Một cấp duyệt là mặc định; ngoại lệ duy nhất là GIR `AVAILABLE_STOCK` (hai bước, §3).
- HĐ không áp dụng vòng đời phê duyệt này (§9.1).
- Mã `approval_status`: `DRAFT` (Nháp), `WAITING_FOR_APPROVE` (Chờ duyệt; không dùng `PENDING`), `APPROVED` (Đã duyệt), `REJECTED` (Bị từ chối), `CANCELED` (Đã hủy; không dùng `CANCELLED`). Quy tắc chuyển trạng thái không đổi.
- Người tạo không tự duyệt; người duyệt không sửa nội dung.
- Từ chối và Thu hồi cần lý do; Nháp/Bị từ chối có thể Hủy; Chờ duyệt phải Thu hồi trước khi Hủy.
- PR Đã duyệt chỉ Thu hồi/Hủy khi không có PO chưa Hủy tham chiếu.
- PO Đã duyệt chỉ Thu hồi/Hủy khi không còn GRR chưa Hủy tham chiếu và đáp ứng quy tắc trạng thái (GIR không tham chiếu PO).
- GRR Đã duyệt không Thu hồi/Hủy khi còn GR chưa Hủy.
- GR Đã duyệt không Hủy trực tiếp; được Thu hồi theo điều kiện §2.2. GI Đã duyệt không Thu hồi/Hủy.
- GIR Đã duyệt: Thu hồi về Nháp chỉ khi chưa có GI, hoặc mọi GI liên quan đã Hủy và không có xuất kho thực tế (§10.4). Hoàn thành xuất: §10.3.
- Chứng từ Đã duyệt không sửa nội dung; ghi chú bổ sung chỉ được thêm, có người tạo và thời điểm.

## 7. Đồng thời và tính toàn vẹn
- Tại các điểm Gửi duyệt/Duyệt phải kiểm tra lại hạn mức tương ứng và trạng thái nguồn; thao tác đồng thời không được tạo vượt số lượng.
- Khi Gửi duyệt GI, phải giữ chỗ số lượng/SN và xác nhận tồn trong cùng một thao tác nhất quán.
- Không tính trùng lượng đã xuất và phần cam kết chưa xuất.
- GIR không giữ chỗ tồn; hạn mức GIR là hạn mức theo dòng HĐ (§10.1), không đồng nhất với tồn kho.

## 8. Chưa chốt, không tự suy diễn
1. ~~Đổi PN chính thức sang PN chính thức khác tại PO/GRR~~ — đã chốt §1a.
2. ~~Sửa HĐ đã được tham chiếu~~ — đã chốt §9.1.
3. ~~Hạn mức giao theo HĐ~~ — đã chốt §10.1 (trừ hạn mức riêng theo từng Product của dòng HĐ — chưa chốt).
4. ~~Giới hạn số lượng GIR hàng có sẵn~~ — đã chốt §3.
5. ~~GIR hàng có sẵn có cần khách hàng~~ — đã chốt: bắt buộc HĐ (khách hàng theo HĐ).
6. ~~Trạng thái đề xuất Product~~ — đã chốt §9.2.
7. ~~Trạng thái thực hiện GIR~~ — đã chốt §10.3.

## 9. HĐ bán — đã chốt (2026-11-13)
### 9.1 Vòng đời
- Trạng thái: `DRAFT`, `ACTIVE`, `CANCELED`. Không có workflow phê duyệt HĐ; không dùng `approval_status`.
- Sales tạo, sửa, chốt (`DRAFT` → `ACTIVE`).
- Chỉ HĐ `ACTIVE` được tham chiếu khi tạo PR/GIR.
- HĐ `ACTIVE` khóa nội dung nghiệp vụ. HĐ đã được PR/GIR tham chiếu khóa khách hàng, PN, UoM, số lượng và điều khoản liên quan, kể cả khi chưa chốt.
- HĐ không quay lại `DRAFT` sau khi `ACTIVE`.
- Chỉ Hủy HĐ khi không còn PR/GIR chưa `CANCELED` tham chiếu.
- Ngoài MVP: phụ lục, điều chỉnh HĐ đã chốt, versioning.

### 9.2 Dòng HĐ và Product được phép giao
- Mỗi dòng HĐ có ID riêng, lưu nguyên thông tin hàng hóa khách hàng ký (kể cả mã/tên chưa chuẩn hóa); không bắt buộc Product chính thức.
- Một dòng HĐ được liên kết **nhiều** Product chính thức, kể cả hàng thay thế.
- PM đề xuất Product (kèm lý do); Sales xác nhận hoặc từ chối theo từng dòng HĐ. Lưu người xác nhận, thời điểm, ghi chú hoặc số phụ lục; không quản lý quy trình ký phụ lục.
- Mapping PR → Product (chuẩn hóa hàng mua, §1a) và xác nhận Product cho dòng HĐ (hàng được phép giao) là **hai trách nhiệm tách biệt**, không gộp.
- Đề xuất mapping dòng HĐ ↔ Product có trạng thái `PENDING` → `APPROVED` | `REJECTED` (PM tạo, Sales quyết định). Đây là trạng thái của đề xuất, không phải `approval_status` chứng từ.
- Không cho thu hồi xác nhận (`APPROVED`) đang được dòng GIR hàng bán chưa `CANCELED` sử dụng. Dòng GIR vật tư cùng Product không tính là sử dụng xác nhận này.
- Đề xuất `PENDING`/`REJECTED` không làm Product thành "đã sử dụng" (§1c).
- Không có hạn mức riêng theo từng Product; chỉ hạn mức theo dòng HĐ (§10.1).

## 10. Hạn mức, hoàn thành xuất, thu hồi GIR — đã chốt (2026-11-13)
### 10.1 Hạn mức theo dòng HĐ
- Quản lý theo **`sales_contract_line_id`**, không cộng gộp theo PN. Chỉ dòng GIR hàng bán chiếm hạn mức; luồng A (theo PR) và B (trực tiếp) **dùng chung** một hạn mức của dòng HĐ, kể cả khi nhiều PR tham chiếu cùng dòng HĐ. Dòng GIR vật tư không chiếm (ADR-0012).
- **Trạng thái chiếm hạn mức** (đã chốt 2026-11-13, CT2; **thay thế** quy tắc cũ "GIR `DRAFT` chiếm hạn mức"): `WAITING_FOR_APPROVE`, `REJECTED`, `APPROVED` chiếm; `DRAFT` và `CANCELED` không chiếm. `REJECTED` giữ hạn mức vì có thể sửa và Gửi duyệt lại. Áp dụng như nhau cho hạn mức giao dòng HĐ và hạn mức dòng PR (§3).
- GIR `COMPLETED` chỉ chiếm bằng số lượng thực xuất (GI `APPROVED`).
- UI hiển thị số lượng HĐ, đã đề nghị ở GIR khác, còn được đề nghị.
- Backend kiểm tra hạn mức khi **Gửi duyệt** (kể cả GIR `DRAFT` đã tạo từ trước) và kiểm tra lại khi **Duyệt**. Lưu `DRAFT` không bị chặn bởi hạn mức (UI vẫn hiển thị số còn lại). Sửa số lượng GIR `REJECTED`: kiểm tra lại hạn mức, không tính trùng lượng chính GIR đó đang giữ. Chống race condition bằng transaction/khóa khi nhiều GIR cùng dùng một hạn mức.
- Lượng đã thực xuất (GI `APPROVED`) tính theo quy tắc hiện hữu: GIR `COMPLETED` chỉ chiếm bằng lượng thực xuất (§10.3); không cộng trùng GIR và GI.
- `AVAILABLE_STOCK` còn bị giới hạn bởi tồn khả dụng của người phụ trách nguồn hàng (§3). Luồng A còn bị giới hạn bởi hạn mức dòng PR (§3).

### 10.2 Phụ trách
- PM phụ trách GIR; Quản lý kho phụ trách GI.

### 10.3 Hoàn thành xuất
- Quản lý kho "Xác nhận hoàn thành xuất" từ màn hình GI; hiệu lực cho toàn bộ GIR.
- GIR giữ `approval_status = APPROVED`; trạng thái thực hiện riêng `execution_status`: `NOT_STARTED` (chưa có GI `APPROVED`) → `IN_PROGRESS` (có GI `APPROVED`) → `COMPLETED` (đã xác nhận hoàn thành).
- Chặn nếu còn GI `DRAFT`, `WAITING_FOR_APPROVE` hoặc `REJECTED`; phải xử lý/Hủy trước, không tự động Hủy.
- Hoàn thành khi lượng thực xuất < số lượng GIR: **bắt buộc lý do**.
- GI `APPROVED` và lịch sử xuất giữ nguyên; GI `CANCELED` không tính vào lượng thực xuất.
- Khi hoàn thành: tổng hợp lượng thực xuất, giải phóng phần chưa xuất khỏi hạn mức HĐ; không cho tạo GI mới.
- Thực hiện trong transaction có khóa để không có GI mới phát sinh đồng thời.
- Thay thế quy tắc "đóng sớm" cũ.

### 10.4 Thu hồi GIR
- Thu hồi đưa GIR về `DRAFT`; phải Gửi duyệt và duyệt lại.
- GIR `APPROVED` chưa có GI: được Thu hồi.
- GIR đã có GI: chỉ Thu hồi khi mọi GI liên quan đã Hủy và không có xuất kho thực tế.
- GIR đang trong quy trình duyệt không sửa trực tiếp.
- `AVAILABLE_STOCK`: Thu hồi làm mất hiệu lực xác nhận của vòng duyệt cũ; duyệt lại từ bước người phụ trách nguồn hàng.
- Điều kiện Thu hồi PR/PO/GRR và quy tắc Inventory đã chốt giữ nguyên.

## 11. Đánh số và hủy chứng từ — đã chốt (2026-11-13)
- HĐ, PR, PO, GRR, GR, GIR, GI tự sinh `document_number` khi tạo.
- Định dạng đề xuất: `SC-2026-000001`, `PR-2026-000001`, `PO-2026-000001`, `GRR-2026-000001`, `GR-2026-000001`, `GIR-2026-000001`, `GI-2026-000001`.
- Mỗi loại một dãy số riêng, reset theo năm; không đánh số theo kho.
- **Không xóa chứng từ, kể cả `DRAFT`**; chỉ Hủy (`CANCELED`) theo điều kiện nghiệp vụ.
- Số đã cấp bất biến, không đánh số lùi, không tái sử dụng; chấp nhận khoảng trống khi chứng từ bị hủy.
- ID database tách biệt số chứng từ; không trùng khi tạo đồng thời.
- Ngoài MVP: đánh số lại, tích hợp kế toán.

## 12. Giao diện chứng từ — đã chốt (2026-11-13)
- Tab chung: Thông tin chung, Người phê duyệt, Hồ sơ đính kèm, Ghi chú. GR thêm "Chi tiết hàng nhập kho".
- MVP chỉ cần file đính kèm và ghi chú cơ bản. File lưu ở local storage của backend; metadata trong DB.

## Quy ước thuật ngữ và tên bảng
PR = Purchase Requisition (`purchase_requisitions`); PO = Purchase Order (`purchase_orders`); GRR = Goods Receipt Request (`goods_receipt_requests`); GR = Goods Receipt (`goods_receipts`); GIR = Goods Issue Request (`goods_issue_requests`); GI = Goods Issue (`goods_issues`). Các bảng dòng dùng hậu tố `_lines`. Tham chiếu chi tiết xem `01-MVP-SCOPE.md`.
