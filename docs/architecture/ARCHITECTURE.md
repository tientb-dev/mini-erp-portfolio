# Kiến trúc hệ thống

**Trạng thái:** ĐÃ PHÊ DUYỆT ở mức kiến trúc (2026-11-12). Chưa có code, entity, migration hay schema.
Các quyết định đã chốt được ghi trong [`decisions/`](decisions/). Câu hỏi còn mở: [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md).

Căn cứ nghiệp vụ cao nhất: [`docs/01`–`05`](../). Tài liệu này không ghi đè tài liệu nghiệp vụ.

---

## 1. Technology stack đã chốt — [ADR-0001](decisions/ADR-0001-technology-stack.md)

| Hạng mục | Lựa chọn |
|---|---|
| Backend | NestJS + TypeScript |
| Frontend | React + TypeScript, Vite, React Router |
| Database | PostgreSQL |
| ORM / migration | **TypeORM** — migration viết/commit thủ công, `synchronize: false` ở mọi môi trường trừ test tạm thời |
| UI | **MUI** + **MUI X Data Grid Community** |
| Server state | TanStack Query |
| Form | React Hook Form + Zod |
| API contract | OpenAPI (`@nestjs/swagger`) + **Orval** sinh client có type |
| i18n giao diện | `react-i18next` (`vi` mặc định, `en`) |
| Kiểm thử | Jest (backend), Vitest + Testing Library (frontend), Playwright (E2E), PostgreSQL thật cho integration test |
| DX | pnpm workspaces (không Nx/Turborepo), ESLint + Prettier, Docker Compose (PostgreSQL), GitHub Actions |
| Kiến trúc | Modular Monolith: 1 backend, 1 frontend, 1 database |

Không dùng: Drizzle, Ant Design, microservices, message broker, distributed transaction, Kubernetes.

Các đề xuất bổ trợ chưa bị thay đổi và vẫn áp dụng: class-validator cho DTO, `@nestjs/config` + kiểm tra env khi khởi động, `nestjs-pino`, lỗi theo RFC 9457 Problem Details với `code` nghiệp vụ, JWT access token + refresh token httpOnly cookie, mật khẩu argon2. Chưa cài git hooks.

### 1.1 Quy tắc dùng TypeORM
- Mọi thao tác ghi cần nhất quán chạy trong `dataSource.transaction(...)` / `QueryRunner`; `EntityManager` của transaction được truyền xuống facade của module khác — **không** dùng repository mặc định bên trong transaction.
- Pessimistic lock: `setLock('pessimistic_write')` (`SELECT … FOR UPDATE`) trên các dòng giới hạn, khóa theo thứ tự xác định (ví dụ theo `id` tăng dần) để tránh deadlock.
- Optimistic concurrency cho chứng từ đang sửa: cột `@VersionColumn` → trả `409 STALE_VERSION` khi dữ liệu đã cũ.
- Ràng buộc database (unique, check, FK) là lớp bảo vệ cuối, không chỉ dựa vào code.
- Thao tác đọc thông thường không cần mở transaction riêng.
- Tránh `cascade`, `eager` relation và lazy loading ngầm; truy vấn tường minh.

---

## 2. Module — [ADR-0002](decisions/ADR-0002-modular-monolith-boundaries.md)

| # | Module | Trách nhiệm |
|---|---|---|
| 1 | **Identity & Access** | User, đăng nhập, role, permission, phạm vi kho; hàm kiểm tra quyền |
| 2 | **Master Data** | Danh mục hàng hóa: mã tạm (`temporary_products`), mã chính (`products`), hãng, tiền tệ, thuế suất, đơn vị tính, khách hàng, nhà cung cấp, kho; bản dịch danh mục |
| 3 | **Sales Contracts** | HĐ (`DRAFT`/`ACTIVE`/`CANCELED`, không duyệt), dòng HĐ, Product được phép giao theo dòng HĐ (đề xuất PM, xác nhận Sales), hạn mức GIR hàng bán theo dòng HĐ; dòng vật tư chỉ gắn HĐ (ADR-0009, ADR-0010, ADR-0012) |
| 4 | **Procurement** | PR, PO; hạn mức dòng PR → dòng PO; hạn mức và tiến độ nhập trên dòng PO |
| 5 | **Inbound** | GRR, GR, chi tiết GR; một GR chưa Hủy cho mỗi GRR |
| 6 | **Outbound** | GIR (`PURCHASE_REQUISITION` / `AVAILABLE_STOCK`, phân loại hàng bán/vật tư; bốn luồng hàng bán/vật tư theo PR/trực tiếp, ADR-0012), GI; hạn mức dòng GIR → dòng GI; hoàn thành xuất (`COMPLETED`) (ADR-0010) |
| 7 | **Inventory** | Số dư Kho + PN, giữ chỗ, SN, lịch sử biến động, lịch sử SN |
| 8 | **Workflow & Notifications** | Vòng đời `approval_status` (một cấp; hai bước cho GIR `AVAILABLE_STOCK`), người duyệt mặc định/được chỉ định, lý do, ghi chú, đính kèm, cấp `document_number` (ADR-0011), thông báo trong ứng dụng |

### 2.1 Phụ thuộc cho phép (không vòng lặp)

```
Inbound ──► Procurement ──► Sales Contracts ◄── Outbound
   │                                              │
   └──────────────► Inventory ◄───────────────────┘
        (mọi module) ──► Workflow & Notifications, Master Data, Identity & Access
```

- Mỗi module export **một facade service**; repository và service nội bộ không export.
- Inventory không import Inbound/Outbound; nhận tham chiếu chứng từ nguồn dưới dạng giá trị (loại chứng từ + id dòng).
- Workflow không biết chi tiết chứng từ; module sở hữu chứng từ tự kiểm tra điều kiện Thu hồi/Hủy.
- Gọi đồng bộ trong cùng tiến trình. Không event bus, không outbox trong MVP.
- Ranh giới được kiểm soát bằng ESLint (`import/no-restricted-paths` hoặc tương đương) khi scaffold.
- **Kiểm tra "đã được tham chiếu" ở module nền tảng** (khóa nội dung HĐ, điều kiện Hủy HĐ — Sales Contracts; khóa mã/tên/UoM/`is_serial_tracked` Product — Master Data) không được import ngược Procurement/Inbound/Outbound. Dùng cùng mẫu ADR-0003: module nghiệp vụ gọi facade của module được tham chiếu, trong cùng transaction, để ghi dấu tham chiếu (cờ/bộ đếm, chốt ở ERD) và khóa dòng (`FOR SHARE`/`FOR UPDATE`) — sửa/Hủy ở module nền tảng chỉ đọc dấu này.

### 2.1a Điểm khóa đồng thời mới (2026-11-13)
| Thao tác | Dòng bị khóa |
|---|---|
| Tạo/sửa/Gửi duyệt/Duyệt/Hủy GIR hàng bán (luồng A, B); hoàn thành xuất | dòng HĐ (`pessimistic_write`) — hạn mức dùng chung theo `sales_contract_line_id`; dòng vật tư không khóa dòng HĐ (ADR-0012) |
| Tạo/sửa/Gửi duyệt/Duyệt/Hủy GIR theo PR (luồng A, C) | dòng PR (`pessimistic_write`, qua facade Procurement) — *đề xuất, chưa triển khai* |
| Tạo GI, hoàn thành xuất, Thu hồi GIR | dòng GIR (`pessimistic_write`) |
| Cấp `document_number` | bộ đếm (loại, năm) (ADR-0011) |
| Sửa nội dung/Hủy HĐ vs tạo PR/GIR tham chiếu | dòng HĐ / HĐ |
Thứ tự khóa khi một thao tác cần nhiều điểm: dòng HĐ → dòng PR (GIR A/C, qua `ProcurementFacade.lockLinesForIssue`) → dòng GIR → `inventories` → `inventory_lots` → `inventory_serials`. Outbound → Procurement là phụ thuộc một chiều qua facade (CT8); Procurement không phụ thuộc Outbound.

### 2.2 Procurement lấy tiến độ nhập từ Inbound — [ADR-0003](decisions/ADR-0003-procurement-inbound-progress.md)

**Inbound gọi Procurement, không bao giờ ngược lại.** Dòng PO giữ các số lượng tổng hợp do Inbound cập nhật qua facade của Procurement, trong **cùng transaction** với thao tác GRR/GR:

| Thời điểm (Inbound) | Gọi facade Procurement | Tác dụng |
|---|---|---|
| Gửi duyệt GRR | khóa dòng PO, kiểm tra và cộng lượng đã cam kết nhập | Kiểm soát Σ GRR Chờ duyệt + Đã duyệt ≤ PO Đã duyệt |
| Từ chối / Thu hồi / Hủy GRR | trừ lượng đã cam kết | Giải phóng hạn mức |
| Duyệt GR | cộng lượng thực nhập | Tình trạng nhập kho PO: Chưa nhập kho / Nhập kho một phần / Đã nhập kho |
| Thu hồi GR Đã duyệt | trừ lượng thực nhập | Tiến độ nhập được tính lại |
| Tạo / Hủy GRR | cập nhật số GRR chưa Hủy của PO | Điều kiện Thu hồi/Hủy PO Đã duyệt |

Dòng PO vừa là nơi lưu tổng hợp vừa là dòng bị khóa để kiểm tra hạn mức. Tên cột cụ thể quyết định ở ERD. Phương án bị loại: `forwardRef` (vòng lặp), event bus (thừa), Procurement truy vấn bảng của Inbound (phá ranh giới).

---

## 3. Inventory — [ADR-0004](decisions/ADR-0004-inventory-model.md)

Mô hình bốn bảng làm nền:

| Bảng | Vai trò |
|---|---|
| `inventories` | Số dư theo Warehouse + PN: tồn thực tế, lượng đang giữ chỗ |
| `inventory_transactions` | Biến động số lượng hiện hành (chỉ từ GR/GI Đã duyệt) |
| `inventory_serials` | Mỗi SN đã nhập kho: PN, kho, `goods_receipt_detail_id`, trạng thái hiện tại |
| `inventory_serial_transactions` | Lịch sử biến động từng SN |

Nguyên tắc bắt buộc:
- Chỉ GR/GI Đã duyệt sinh biến động tồn thực tế. GR Nháp/Chờ duyệt/Bị từ chối/Đã hủy không tác động Inventory và **không giữ chỗ SN**; SN của GR chưa duyệt chỉ nằm ở `goods_receipt_details`.
- GI Chờ duyệt tăng lượng giữ chỗ trên `inventories` và đánh dấu SN đang giữ chỗ; không giảm tồn thực tế. Từ chối/Thu hồi giải phóng.
- GI Đã duyệt: giảm tồn thực tế, giảm giữ chỗ tương ứng, ghi `inventory_transactions` và `inventory_serial_transactions`; SN chuyển trạng thái đã xuất, **không xóa**.
- Tồn khả dụng = tồn thực tế − giữ chỗ (tính từ cùng một dòng `inventories`, không phải sổ riêng).
- Check constraint: tồn thực tế ≥ 0, giữ chỗ ≥ 0, giữ chỗ ≤ tồn thực tế.
- Unique vĩnh viễn trên (PN, normalized SN); lưu thêm SN gốc để hiển thị.
- Chống ghi trùng khi retry/đồng thời: unique trên (loại chứng từ nguồn, id dòng nguồn, loại biến động) ở bảng transaction; kết hợp chuyển trạng thái chứng từ có điều kiện (`UPDATE … WHERE approval_status = 'WAITING_FOR_APPROVE'`).
- Đối chiếu được: số dư `inventories` = Σ `inventory_transactions` theo Warehouse + PN; có thể viết truy vấn đối chiếu làm kiểm thử.
- Đổi trạng thái chứng từ + tồn + SN + thông báo trong một transaction.

### 3.1 GR và Inventory (03 §2)
- Dữ liệu chứng từ: `goods_receipt_request_lines` → `goods_receipt_lines` → `goods_receipt_details` (SN khai báo ở đây; không bao giờ bị xóa khi Thu hồi/Hủy).
- **Duyệt GR:** khóa `inventories` liên quan → kiểm tra SN → tăng số dư, ghi `inventory_transactions`, tạo `inventory_serials` (unique PN + normalized SN) và `inventory_serial_transactions` → cập nhật lượng thực nhập trên dòng PO (ADR-0003).
- **Gửi duyệt GR:** chặn SN trùng trong GR hoặc đã có trong `inventory_serials`; không kiểm tra GR Chờ duyệt khác.
- **Duyệt thất bại** (trùng SN do unique index): rollback toàn bộ transaction → GR giữ Chờ duyệt.
- **Thu hồi GR Đã duyệt** (người tạo): khóa `inventories` + `inventory_serials` của GR → kiểm tra không SN nào còn được GI chưa Hủy tham chiếu, số dư không-SN đủ sau hoàn tác → xóa bản ghi Inventory hiện hành của lần duyệt đó, trừ số dư, giảm lượng thực nhập trên dòng PO → GR về Nháp. Không đạt một điểm → từ chối toàn bộ.
- **Hủy GR:** chỉ Nháp/Bị từ chối; không tác động Inventory.
- Lưu GI (kể cả Nháp) khi thêm SN phải khóa dòng `inventory_serials` tương ứng (`FOR SHARE` hoặc `FOR UPDATE`) để tuần tự hóa với Thu hồi GR (B26).
- **Quan hệ SN (ADR-0004 §8):** `inventory_serials` và `goods_issue_serials` cùng tham chiếu `goods_receipt_details.id`. Khả dụng của SN luôn xác định qua `inventory_serials`; điều kiện Thu hồi GR kiểm tra `goods_issue_serials` của GI chưa Hủy.
- Cơ chế SN duy nhất vĩnh viễn, chống ghi trùng, FK và truy vết: ADR-0004.

Tồn theo HĐ nguồn/Sales phụ trách/GR: ADR-0013 (thiết kế lô chờ review). Ngoài MVP: duyệt điều phối nhiều cấp, tồn theo location (WMS). Location trên chi tiết GR chỉ là thông tin lịch sử.

---

## 4. Master Data — [ADR-0005](decisions/ADR-0005-master-data-and-i18n.md)

- Giao diện gọi chung là **Danh mục hàng hóa**, gồm hai bảng tách biệt:
  - `temporary_products` (mã tạm): mã, tên, mô tả; không UoM.
  - `products` (mã chính, PN): `part_number` duy nhất, UoM, `is_serial_tracked` (mặc định `true`), thông tin kế toán dự trù, tên, mô tả, model, thương hiệu/nhà sản xuất, nhóm hàng, trạng thái đang dùng/ngừng dùng. Không dùng SKU.
- Danh mục phụ tối thiểu: `product_categories`, `units_of_measure`. Không thêm danh mục khác khi chưa có nhu cầu.
- SN là dữ liệu hàng thực tế (Inventory), không thuộc `products`.
- Không xóa cứng mã đã phát sinh chứng từ → ngừng sử dụng.
- `is_serial_tracked` bị khóa nếu PN từng xuất hiện trên GRR/GR/GIR/GI, bất kể trạng thái.
- Mã tạm không có bản dịch. Dòng HĐ lưu thông tin gốc, không bắt buộc mã chính (ADR-0009 thay thế T3).
- Sau khi Product được dùng: khóa `part_number`, tên, UoM; mô tả và trạng thái hoạt động sửa được; không xóa. Chứng từ sau PR tham chiếu `product_id`, không snapshot tên/mô tả.
- Kho có thuộc tính `allow_available_stock_issue` (đề xuất) cho GIR `AVAILABLE_STOCK`.
- `products.unit_of_measure_id` bị khóa khi mã chính đã xuất hiện trên PR, PO, GRR, GR, HĐ, GIR, GI, mọi trạng thái (`PRODUCT_UOM_LOCKED`). Sửa UoM khóa `products` `FOR UPDATE`; xác định mã thực nhận và thêm dòng chứng từ khóa `products` trong transaction → tuần tự (ADR-0008).

### 4.1 Mã tạm và mã chính thực nhận — [ADR-0008](decisions/ADR-0008-temporary-product-mapping.md)
- HĐ lưu snapshot và tối đa một tham chiếu danh mục. PR lưu snapshot và chọn mã tạm hoặc mã chính.
- PO chưa nhận dòng PR mã tạm trong PR #19. Khi mở luồng mã tạm ở kho, GRR phải xác định mã chính trước Gửi duyệt và giữ nguyên chứng từ nguồn.
- ĐVT và hạn mức tiếp tục theo dòng nguồn. Không quy đổi ĐVT hoặc số lượng. Một dòng PO được dùng tối đa một lần trong cùng GRR.

---

## 5. Đa ngôn ngữ — [ADR-0005](decisions/ADR-0005-master-data-and-i18n.md)

- Ngôn ngữ: `vi` (mặc định), `en`. Không có dịch tự động.
- **Giao diện:** `react-i18next`; mọi menu, nút, trạng thái, nhãn, thông báo, lỗi đều qua key dịch. Backend trả `code` lỗi, frontend dịch.
- **Danh mục:** bảng chính + bảng translation (`product_translations`, `product_category_translations`, bản dịch đơn vị tính nếu cần); unique (entity_id, `language_code`); fallback về `vi`.
- Không dịch PN, SN, mã kho, mã định danh; không mặc định dịch tên pháp lý khách hàng/nhà cung cấp.
- Chứng từ tham chiếu product ID, không tham chiếu bản dịch. HĐ/PR giữ thông tin gốc; chứng từ khác không snapshot tên/mô tả (M2 đã chốt).

---

## 6. Phân quyền — [ADR-0006](decisions/ADR-0006-permission-model.md)

**User → Role → Permission (Function + Action)**, ví dụ `PR.CREATE`, `PO.APPROVE`, `GR.DECLARE_DETAILS`, `GI.APPROVE`, `INVENTORY.VIEW`, `SN_HISTORY.VIEW`.

Bảng: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_warehouses`.

Ba lớp kiểm tra tách biệt:
1. **Permission** — được làm loại thao tác nào (guard ở controller).
2. **Warehouse scope** — được thao tác ở kho nào (chứng từ kho, tồn kho, lịch sử SN).
3. **Business rules** — trạng thái chứng từ, người tạo không tự duyệt, hạn mức, tồn, SN (trong module nghiệp vụ).

Ngoại lệ đã có giữ nguyên: `GR.DECLARE_DETAILS` cho phép sửa chi tiết GR Nháp/Bị từ chối của người khác trong kho được phép; chỉ người tạo Gửi duyệt/Thu hồi/Hủy. Người tạo luôn xem được chứng từ của mình. Lịch sử SN không tiết lộ SN ngoài phạm vi kho.

`user_warehouses` áp dụng chung cho mọi permission của user; không có role theo kho (P1 đã chốt, chấp nhận giới hạn). Người duyệt mặc định cấu hình theo role/bước duyệt, có thể chọn người khác đủ điều kiện; backend kiểm tra khi Gửi duyệt (ADR-0006).

---

## 7. Workflow — [ADR-0007](decisions/ADR-0007-workflow.md), [ADR-0010](decisions/ADR-0010-gir-limits-approval-completion.md), [ADR-0011](decisions/ADR-0011-document-numbering-and-no-delete.md)

Module document records cung cấp Notes và Activity History dùng chung. Module sở hữu chứng từ kiểm tra đích và quyền. Activity append-only kể cả khi workflow có state, assignment và snapshot riêng. Xem [ADR-0016](decisions/ADR-0016-common-document-records.md) và [roadmap Dossier/Organization](DOCUMENT-DOSSIER-ORGANIZATION-ROADMAP.md).

PR phối hợp thao tác lưu chứng từ và Gửi duyệt trong cùng transaction ở module Procurement. Workflow nhận cùng EntityManager với thao tác ghi header, dòng hàng và phân công. Các API kết hợp vẫn kiểm tra ngữ cảnh workflow và ghi Activity History cùng Notification trong transaction đó. Xem [ADR-0015](decisions/ADR-0015-purchase-requisition-workflow.md) và [chuẩn Common Document Page](FRONTEND.md).

#### API và lưu trữ PR Phase 2

- `POST /purchase-requisitions`, `POST /purchase-requisitions/save-new`, `PATCH /purchase-requisitions/:id` và `PATCH /purchase-requisitions/:id/submit-edited` nhận các trường `name`, `requisitionDate`, `requiredDate`, `description`, `currencyId`, `exchangeRateSource` và `exchangeRate` bên cạnh hợp đồng API hiện có. Ngày dùng `YYYY-MM-DD`. Chỉ gửi `exchangeRate` khi nhập thủ công. Backend lấy người đề nghị từ phiên đăng nhập. HĐ ACTIVE bắt buộc ngay từ Nháp cho cả hai phân loại theo DEC-19-08. Backend dùng phạm vi theo HĐ và quyền của PR #18. HĐ và phân loại đã lưu giữ nguyên khi sửa.
- Dòng nhận đúng một trong `productId` và `temporaryProductId`, cùng số lượng và các trường `salesContractLineId`, `requirementDescription`, `brandId`, `supplierId`, `unitOfMeasureId`, `unitPrice`, `taxRateId`. Gửi `unitPrice` dưới dạng chuỗi thập phân. PATCH gửi toàn bộ danh sách dòng và ID của dòng giữ lại. Danh sách PR và chi tiết trả snapshot tiền tệ, tỷ giá và tổng tiền. Chi tiết trả nguồn từng dòng, snapshot danh mục và tiền từng dòng. Giá trị tiền trong JSON là chuỗi thập phân hoặc `null`.
- Picker dùng API Products, Temporary Products, Brands, Units of Measure, Currencies và Tax Rates. `GET /purchase-requisitions/catalog/suppliers?salesContractId=…&brandId=…` trả NCC Active liên kết với Hãng sau khi kiểm tra `PR.CREATE` và phạm vi HĐ như khi tạo PR. Có thể thêm `route=SALES` hoặc `route=PM` khi người dùng có cả hai vai trò trên HĐ. Chi tiết HĐ bán trả `productId` và `temporaryProductId` để xác định ứng viên mapping theo SC-LINE-INPUT-001. Dòng nhập tự do có cả hai ID rỗng.
- Migration `1733097600000` bổ sung snapshot vào `purchase_requisitions` và `purchase_requisition_lines`. CHECK và FK bảo đảm đúng một nguồn. Các cột mới cho phép đọc chứng từ cũ khi dữ liệu lịch sử thiếu căn cứ. Gửi duyệt kiểm tra các trường còn thiếu. Số tiền được tính từ snapshot bằng PostgreSQL `numeric`; xem [ADR-0017](decisions/ADR-0017-pr-business-completion.md).

#### Tính tiền dùng chung cho chứng từ ERP

DEC-19-07 đặt giới hạn precision chung trong `common/document-money.ts`. Chứng từ lưu nguồn và cấu hình tiền tệ tại thời điểm chọn, gồm số chữ số thập phân và tỷ giá. Helper dùng PostgreSQL `round(numeric, scale)` theo `ROUND_HALF_UP` để tính thành tiền trước, sau đó tính thuế trên thành tiền đã làm tròn. Backend cộng các dòng đã làm tròn để trả tổng chứng từ. PR dùng quy tắc này trong Phase 2. Số lượng lưu `numeric(18,3)`. Cột thuế suất danh mục hiện hữu giữ kiểu lưu trữ để bảo toàn dữ liệu. API giới hạn giá trị mới và snapshot dùng cho chứng từ theo DEC-19-07.

#### API danh sách và picker của Phase 3

- `GET /purchase-requisitions?page=1&size=25` trả `{ items, total }`. Hỗ trợ `q`, `category`, `status`, `from`, `to`, `assignedToMe`, `sort`, `direction` và `salesContractId`. `from/to` lọc ngày đề nghị với hai biên bao gồm. Request không gửi `page` tiếp tục nhận mảng cho tab PR trong HĐ. HĐ hiện có mã chứng từ và khách hàng. Tìm kiếm dùng hai trường đó kết hợp mã và tên PR.
- `GET /purchase-requisitions/catalog/contracts?q=…` trả tối đa 25 HĐ ACTIVE theo phạm vi người tạo. `GET /product-picker/main` và `/product-picker/temporary` trả danh mục Active theo trang, tìm mã/tên, sort và lọc Hãng với mã chính.
- Editor gửi số lượng dưới dạng chuỗi thập phân để giữ đủ precision đến PostgreSQL. API tiếp tục chấp nhận số JSON của các client cũ.
- Editor gửi `refreshCatalogExchangeRate: true` khi người dùng bỏ chọn nhập tỷ giá thủ công. Backend đọc tỷ giá danh mục ở thao tác rõ ràng này, giữ precision của snapshot tiền tệ hiện hữu. Lưu lại hoặc gửi duyệt thông thường tiếp tục dùng snapshot.

- Một cấp phê duyệt cho PR, PO, GRR, GR, GIR `SALES_CONTRACT`, GI. **Ngoại lệ:** GIR `AVAILABLE_STOCK` hai bước người phụ trách nguồn hàng → Quản lý kho. HĐ không phê duyệt (`DRAFT`/`ACTIVE`/`CANCELED`).
- `approval_status`: `DRAFT`, `WAITING_FOR_APPROVE`, `APPROVED`, `REJECTED`, `CANCELED`. Thu hồi luôn về `DRAFT`. PR dùng `WAITING_FOR_RECEIPT` và `DONE` cho bước tiếp nhận và hoàn tất, thay `APPROVED` ở cấp chứng từ (ADR-0015).
- Chuyển trạng thái bằng `UPDATE` có điều kiện trạng thái hiện tại để chống xử lý trùng.
- Trạng thái thực hiện GIR (`COMPLETED`) **tách khỏi** `approval_status`.
- Thông báo ghi trong cùng transaction với chuyển trạng thái.
- `document_number` tự sinh, bất biến; không xóa chứng từ.

---

## 8. Cấu trúc repository

```
mini-erp-portfolio/
├─ docs/                     business docs 01–05 (không di chuyển)
│  └─ architecture/          ARCHITECTURE.md, OPEN-QUESTIONS.md, decisions/ (ADR)
├─ README.md  CLAUDE.md  .gitignore  .editorconfig  .env.example
├─ apps/api/                 (scaffold) NestJS: src/modules/<module>/{api,application,domain,infrastructure}, migrations/
├─ apps/web/                 (scaffold) React + Vite: src/features/<module>, src/api (Orval), src/i18n/{vi,en}
├─ e2e/                      (scaffold) Playwright
├─ docker-compose.yml, pnpm-workspace.yaml, .github/workflows/   (scaffold)
└─ packages/                 không cần trong MVP
```
