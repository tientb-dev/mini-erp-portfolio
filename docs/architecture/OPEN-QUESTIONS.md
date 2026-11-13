# Câu hỏi mở và phát hiện

Tài liệu 01–05 là **MVP baseline** từ 2026-11-13. Câu hỏi mới phát sinh trong implementation ghi vào đây; câu hỏi **chưa chốt** không được triển khai theo giả định.

## 1. Còn mở
CM1–CM6 (ADR-0012) đã chốt nghiệp vụ — xem §4. Còn lại các điểm sau; **không triển khai theo giả định**:

| # | Loại | Câu hỏi | Hiện trạng code |
|---|---|---|---|
| CT1 | Nghiệp vụ (định nghĩa) | `PO done` chính xác là gì: mọi dòng PR đã có PO `APPROVED` đủ số lượng, có ít nhất một PO `APPROVED`, hay điều kiện khác? Dòng PR chỉ lên PO một phần có chọn được không? | Không có trạng thái/cột/truy vấn nào biểu diễn `PO done` |
| CT2 | Nghiệp vụ | Trạng thái GIR nào chiếm hạn mức dòng PR (luồng A/C)? Đề xuất: giống hạn mức dòng HĐ (03 §10.1: `DRAFT`/`WAITING_FOR_APPROVE`/`APPROVED`/`REJECTED` chiếm; `COMPLETED` chỉ chiếm lượng thực xuất). | Không có liên kết dòng GIR → dòng PR |
| CT3 | Nghiệp vụ + kỹ thuật | GI của luồng A/C lấy tồn từ đâu: tồn chung Kho + PN như trước, hay chỉ tồn của người phụ trách nguồn hàng tương ứng? Cơ chế phân bổ xuất theo dòng GR/lô (FIFO, chỉ định, …). | `inventories` duy nhất theo `(warehouse_id, product_id)` |
| CT4 | Kỹ thuật | Mô hình tồn kho theo người phụ trách nguồn hàng: thêm chiều vào `inventories`/`inventory_serials` hay bảng phân bổ riêng; ảnh hưởng ràng buộc không âm tồn, giữ chỗ GI và Thu hồi GR (03 §2.2). | Không có cột người phụ trách |
| CT5 | Nghiệp vụ + kỹ thuật | Người phụ trách nguồn hàng khi duyệt GR được xác định thế nào (mặc định "Sales phụ trách HĐ" lấy từ đâu; ai được sửa; ghi theo GR hay theo dòng GR)? | `sales_contracts` không có trường Sales phụ trách (chỉ `created_by`) |
| CT6 | Kỹ thuật | Schema phân loại dòng (tên cột/giá trị, ở dòng hay cả header), cột mục đích sử dụng (luồng D), cột liên kết dòng GIR → dòng PR; nới `NOT NULL` của `sales_contract_line_id`. | `purchase_requisition_lines`/`goods_issue_request_lines`.`sales_contract_line_id` `NOT NULL` |
| CT7 | Kỹ thuật | Quyền và cách giao bước 1 `AVAILABLE_STOCK` cho người phụ trách nguồn hàng (giữ `GIR.SALES_CONFIRM` hay mã mới); tự điền từ nguồn tồn đã chọn. | IM15: người tạo chọn người có `GIR.SALES_CONFIRM` |
| CT8 | Kỹ thuật | Khóa dòng PR khi kiểm tra hạn mức luồng A/C: phụ thuộc Outbound → Procurement mới (facade), thứ tự khóa dòng HĐ → dòng PR → dòng GIR; kiểm tra không tạo vòng phụ thuộc. | Outbound chưa phụ thuộc Procurement |
| CT9 | Nghiệp vụ | Luồng C (vật tư theo PR) có bắt buộc ghi mục đích sử dụng như luồng D không? (Quyết định chỉ nêu luồng D.) | — |
| CT10 | Nghiệp vụ | Luồng A/C dùng `issue_type = SALES_CONTRACT` hiện có (đổi nghĩa thành "theo PR"); GIR `SALES_CONTRACT` chọn trực tiếp dòng HĐ không qua PR (hiện có trong code) bị thay thế bởi luồng A. Cần xác nhận cách hiểu này. | GIR `SALES_CONTRACT` hiện chọn dòng HĐ, không qua PR |

## 2. Ghi chú (không phải mâu thuẫn)
| # | Nhận xét |
|---|---|
| I3 | "Bảo hành" trong lịch sử SN là trường thông tin trên chi tiết GR; quy trình bảo hành ngoài phạm vi. |
| I8 | GIR `REJECTED` vẫn chiếm hạn mức dòng HĐ; người dùng phải Hủy để giải phóng — UI cần nhắc rõ. |
| I9 | Trạng thái đề xuất Product dùng `PENDING`; đây là trạng thái đề xuất, khác `approval_status` (dùng `WAITING_FOR_APPROVE`). |

## 3. Assumption trong implementation
| # | Assumption | Lý do |
|---|---|---|
| IM1 | Slice đầu chỉ có đăng nhập + RBAC tối thiểu, Product, Warehouse, đọc tồn kho (Inventory foundation). Chưa có chứng từ nên chưa có Inventory ghi biến động qua API. | Vertical slice nhỏ nhất |
| IM2 | Seed dữ liệu: 1 user admin (mật khẩu từ env), role `ADMIN` có mọi permission, 1 UoM, 1 kho. | Chạy được end-to-end |
| IM3 | Phiên đăng nhập: JWT access token (Bearer, lưu `sessionStorage`); chưa có refresh token cookie. | Giảm phạm vi slice đầu; nâng cấp theo ADR-0001 sau |
| IM4 | Băm mật khẩu bằng `scrypt` có sẵn của Node thay vì argon2. | Tránh native build trên Windows/Node 26 |
| IM5 | Chưa dùng React Router, React Hook Form + Zod, Orval: slice có 3 màn hình và form 3–4 trường. Thêm khi làm màn hình chứng từ. | Tránh phụ thuộc chưa cần |
| IM6 | Mỗi module nghiệp vụ một Nest module (Identity, MasterData, Inventory, SalesContracts, Procurement, Inbound, Outbound). Gọi chéo module qua facade tĩnh nhận `EntityManager` của caller (`InventoryFacade`, `SalesContractFacade`, `ProductUsage`) để chung một transaction. Inbound → Procurement vẫn đọc bảng PO/PR trực tiếp (một chiều). | ADR-0002 |
| IM7 (đã chốt) | Khóa Product (03 §1b–1c) dùng cờ `products.is_used` / `is_stock_used` do module chứng từ ghi qua `ProductUsage.markUsed` (FOR SHARE) trong cùng transaction; sửa Product khóa FOR UPDATE. Chưa có bảng `product_translations` nên chưa có gì để khóa ở tên dịch. | ARCHITECTURE §2.1 |
| IM8 | Số lượng `numeric(18,3)`. | Đủ cho hàng nguyên và hàng có số lẻ |
| IM9 | Chưa có GitHub Actions CI, ESLint/Prettier config. | Ngoài slice tối thiểu chạy được |
| IM10 | HĐ/PR/PO/GRR có UI và API đủ vòng đời (danh sách, chi tiết, tạo, Gửi duyệt, Duyệt, Từ chối, Thu hồi, Hủy). Vẫn chỉ dùng mã chính (chưa có `temporary_products`/mapping); `purchase_requisition_lines.product_id` `NOT NULL` — sẽ nới khi thêm mã tạm. | Mã tạm/mapping là slice riêng |
| IM11 | Chưa có: Thu hồi GR **Đã duyệt** (03 §2.2), tiến độ nhập PO (ADR-0003 dùng số tổng hợp — hiện kiểm hạn mức bằng SUM có khóa dòng PO), thông báo trong ứng dụng, đính kèm/ghi chú, vị trí/bảo hành trên chi tiết GR ở UI. | Ngoài phạm vi slice GR |
| IM12 | Người duyệt mặc định: danh sách người đủ điều kiện (permission + kho, khác người tạo); đúng 1 người thì tự chọn. Chưa có bảng cấu hình mặc định theo role/bước. | P4 tối giản |
| IM13 | Repository dùng SQL thuần qua `EntityManager.query` của TypeORM cho chứng từ, để khóa dòng (`FOR UPDATE`) tường minh. | ARCHITECTURE §1.1 |
| IM14 | Seed có 2 user (`admin`, `approver`) cùng role `ADMIN` vì người tạo không được tự duyệt. | Demo/kiểm thử |
| IM15 (đã chốt; cần xem lại theo CT7) | GIR `AVAILABLE_STOCK`: người tạo chọn **cả hai** người duyệt khi Gửi duyệt (Sales xác nhận: quyền `GIR.SALES_CONFIRM`, không ràng buộc kho; Quản lý kho: `GIR.APPROVE` + kho). Bước 2 được giao tự động sau khi Sales xác nhận. | 04 §3 không nói ai chọn người duyệt bước 2 |
| IM16 (đã chốt) | Mã quyền mới: `SALES_CONTRACT.PROPOSE_PRODUCT` (PM), `SALES_CONTRACT.CONFIRM_PRODUCT` (Sales), `GIR.VIEW/CREATE/SALES_CONFIRM/APPROVE/COMPLETE`, `GI.VIEW/CREATE/APPROVE`. | Function–Action (ADR-0006) |
| IM17 (đã chốt) | Trạng thái thực hiện GIR lưu trong cột `execution_status`; `IN_PROGRESS` được đặt khi GI đầu tiên được duyệt. | 03 §10.3 |
| IM18 | Chưa có: sửa nội dung chứng từ Nháp/Bị từ chối trên UI và API cho HĐ, PR, PO, GRR (hiện phải Hủy rồi tạo lại; GI có API `PATCH`), thu hồi xác nhận Product của dòng HĐ, lọc "Chờ tôi duyệt" chung, thông báo trong ứng dụng, đính kèm/ghi chú, tiến độ nhập PO, Thu hồi GR Đã duyệt. | Ngoài phạm vi lượt này |
| IM20 | Seed thêm role nghiệp vụ `SALES`, `PM`, `PURCHASING` (Mua hàng: tạo PR/PO, nhà cung cấp, mã chính), `WAREHOUSE_MANAGER` và user `sales`/`pm`/`purchaser`/`warehouse` (mật khẩu từ `SEED_ROLE_USERS_PASSWORD`, bỏ qua nếu không đặt). 04 §2 không nêu vai trò tạo PR/PO; duyệt PR/PO/GRR/GR hiện do role `ADMIN`. Thêm mã quyền `GRR.VIEW`, `CUSTOMER.VIEW`, `SUPPLIER.VIEW`. | Thử theo role trên trình duyệt |
| IM21 | Thu hồi/Hủy PR, PO, GRR Đã duyệt chỉ khi không còn chứng từ con chưa Hủy (03 §6); Hủy chứng từ Đã duyệt bắt buộc lý do (để thông báo người duyệt trước, 04 §6 — thông báo chưa làm). Lỗi `HAS_ACTIVE_CHILD_DOCUMENTS`. | 03 §6 |
| IM22 | Kiểm tra chứng từ con khi Hủy HĐ (PR/GIR) và khi Thu hồi/Hủy PO (GRR) đọc trực tiếp bảng của module hạ nguồn bằng SQL, ngược chiều đồ thị module; sẽ thay bằng số tổng hợp theo ADR-0003 khi làm tiến độ nhập PO. | Tối giản, có `shortcut:` trong code |
| IM19 | Chưa có hạn mức PR ≤ dòng HĐ (không có trong quy tắc đã chốt). | Không tự suy diễn |

## 4. Đã đóng
| # | Quyết định | Ghi tại |
|---|---|---|
| Kiến trúc | Stack, module, Procurement ← Inbound, Inventory, phân quyền, workflow | ADR-0001…0007 |
| N1, E1, R1–R5, I5, F1, F1a | Inventory, vòng đời SN, thu hồi GR | 03 §2, ADR-0004 |
| Q1, U5, T1–T9, M1, N2, W3, I7 | Mã tạm, mapping, UoM, cờ SN, tên bảng, mã trạng thái | 03 §1a–1c, ADR-0005, ADR-0008 |
| U1, U3, U6, U8, W1, W2 | Hạn mức, `AVAILABLE_STOCK`, duyệt hai bước, hoàn thành xuất, thu hồi | 03 §3, §10, ADR-0010 |
| U2, U4, U7, I2 | HĐ, dòng HĐ, Product được phép giao | 03 §9, ADR-0009 |
| P1, Q6, M2, I6 | Kho theo user, đánh số, khóa Product, SN | ADR-0006, ADR-0011, ADR-0005 |
| P3 | RBAC + data-level theo người được giao duyệt; chỉ người được giao thấy/duyệt/nhận thông báo | 04 §3, ADR-0006 |
| P4 | Mặc định theo role/bước; không duy nhất → dropdown | 04 §3 |
| H1, H4, H5 | Đề xuất `PENDING`/`APPROVED`/`REJECTED`; không thu hồi xác nhận đang dùng; đề xuất chưa duyệt không tính "đã sử dụng" | 03 §9.2, ADR-0009 |
| H2 | Không quay lại `DRAFT`; Hủy HĐ khi không còn PR/GIR chưa Hủy | 03 §9.1 |
| H3 | Không hạn mức riêng theo Product | 03 §9.2 |
| G1–G5 | `execution_status`; điều kiện hoàn thành; lý do khi thiếu; từ chối → `REJECTED`; kho bảo hành không hợp lệ | 03 §3, §10.3, ADR-0010 |
| P2 | Khóa tên dịch | 03 §1c, ADR-0005 |
| A1 | Local storage + metadata DB | ADR-0011 |
| Q4, I4 | Thu hồi/Hủy PO khi không còn GRR chưa Hủy | 03 §6 |
| I1 | Tài liệu thành MVP baseline | 01–05 |
| CM0 | PR/GIR gắn HĐ ở cấp chứng từ; `sales_contract_line_id` chỉ bắt buộc với dòng hàng bán; dòng vật tư; không suy ra dòng HĐ từ Product | 03 §1, §3, §10.1, ADR-0012 |
| CM1 | Vật tư trực tiếp dùng `AVAILABLE_STOCK`; nguồn hàng tách khỏi mục đích sử dụng | 03 §3, ADR-0012 §1.4 |
| CM2 | Bốn luồng GIR; hạn mức dòng PR (A, C) và hạn mức giao dòng HĐ dùng chung (A, B); lượng nhập chỉ tham khảo; người phụ trách nguồn hàng | 03 §3, §5, §10.1, ADR-0012 |
| CM3 | Không trộn hàng bán/vật tư trong PR/GIR ở MVP | 03 §1, §3 |
| CM4 | Phân loại dòng tường minh (schema: CT6) | 03 §1, §3 |
| CM5 | PR vật tư được dùng mã tạm, chuẩn hóa trước khi nhập kho | 03 §1, §1a |
| CM6 | Không chia/trùng dòng HĐ trong một PR; nhiều PR được tham chiếu cùng dòng HĐ | 03 §1 |
