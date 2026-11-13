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
| 2 | **Master Data** | Danh mục hàng hóa: mã tạm (`temporary_products`), mã chính (`products`), nhóm hàng, đơn vị tính, khách hàng, nhà cung cấp, kho; bản dịch danh mục |
| 3 | **Sales Contracts** | HĐ (`DRAFT`/`ACTIVE`/`CANCELED`, không duyệt), dòng HĐ, Product được phép giao theo dòng HĐ (đề xuất PM, xác nhận Sales), hạn mức GIR hàng bán theo dòng HĐ; dòng vật tư chỉ gắn HĐ (ADR-0009, ADR-0010, ADR-0012) |
| 4 | **Procurement** | PR, PO; mapping mã tạm → mã chính trên dòng PR (ADR-0008); hạn mức dòng PR → dòng PO; hạn mức và tiến độ nhập trên dòng PO |
| 5 | **Inbound** | GRR, GR, chi tiết GR; một GR chưa Hủy cho mỗi GRR |
| 6 | **Outbound** | GIR (`SALES_CONTRACT` / `AVAILABLE_STOCK`), GI; hạn mức dòng GIR → dòng GI; hoàn thành xuất (`COMPLETED`) (ADR-0010) |
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
| Tạo/sửa/Gửi duyệt/Duyệt/Hủy GIR có dòng hàng bán; hoàn thành xuất | dòng HĐ (`pessimistic_write`) — hạn mức theo `sales_contract_line_id`; dòng vật tư không khóa dòng HĐ (ADR-0012) |
| Tạo GI, hoàn thành xuất, Thu hồi GIR | dòng GIR (`pessimistic_write`) |
| Cấp `document_number` | bộ đếm (loại, năm) (ADR-0011) |
| Sửa nội dung/Hủy HĐ vs tạo PR/GIR tham chiếu | dòng HĐ / HĐ |
Thứ tự khóa khi một thao tác cần nhiều điểm: dòng HĐ → dòng GIR → `inventories` → `inventory_serials`.

### 2.2 Procurement lấy tiến độ nhập từ Inbound — [ADR-0003](decisions/ADR-0003-procurement-inbound-progress.md)

**Inbound gọi Procurement, không bao giờ ngược lại.** Dòng PO giữ các số lượng tổng hợp do Inbound cập nhật qua facade của Procurement, trong **cùng transaction** với thao tác GRR/GR:

| Thời điểm (Inbound) | Gọi facade Procurement | Tác dụng |
|---|---|---|
| Gửi duyệt GRR | khóa dòng PO, kiểm tra và cộng lượng đã cam kết nhập | Kiểm soát Σ GRR Chờ duyệt + Đã duyệt ≤ PO Đã duyệt |
| Từ chối / Thu hồi / Hủy GRR | trừ lượng đã cam kết | Giải phóng hạn mức |
| Duyệt GR | cộng lượng thực nhập | Tiến độ Chưa nhập / Nhập một phần / Đã nhập đủ |
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

Ngoài MVP: tồn theo người phụ trách, phân bổ tồn theo HĐ, duyệt điều phối nhiều cấp, tồn theo location (WMS). Location trên chi tiết GR chỉ là thông tin lịch sử. Hàng dùng chung theo Warehouse + PN giữ nguyên.

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
- `products.unit_of_measure_id` bị khóa khi mã chính đã xuất hiện trên PR (kể cả qua mapping), PO, GRR, GR, HĐ, GIR, GI, mọi trạng thái (`PRODUCT_UOM_LOCKED`). Sửa UoM khóa `products` `FOR UPDATE`; mapping/thêm dòng chứng từ khóa `products` `FOR SHARE` → tuần tự (ADR-0008).

### 4.1 Mã tạm và mapping — [ADR-0008](decisions/ADR-0008-temporary-product-mapping.md)
- `purchase_requisition_lines` lưu snapshot mã/tên/mô tả/UoM ban đầu; `product_id` nullable là kết quả chuẩn hóa dùng chung cho mọi PO/GRR tham chiếu dòng PR.
- Mapping theo từng dòng PR, một lần, trên PO/GRR `DRAFT`, bằng quyền sửa chứng từ đó; `UPDATE … WHERE product_id IS NULL` chống mapping đồng thời.
- UoM kế thừa PR → PO → GRR và lưu riêng trên từng dòng; không quy đổi; mapping không đổi UoM/số lượng.
- Mapping: khóa dòng PR (`FOR UPDATE`) → kiểm tra chứng từ `DRAFT`, `product_id IS NULL`, UoM mã chính = UoM dòng PR = UoM mọi dòng PO liên quan → cập nhật. Tạo dòng PO từ dòng PR cũng khóa dòng PR (hạn mức Σ PO ≤ PR) nên hai thao tác tuần tự.
- Gửi duyệt GRR: mọi dòng có mã chính và UoM dòng GRR = UoM mã chính (trong transaction đã khóa dòng PO).
- Mã lỗi: `DOCUMENT_NOT_DRAFT`, `PRODUCT_ALREADY_MAPPED`, `MAPPING_UOM_MISMATCH`, `GRR_LINE_NOT_MAPPED`, `GRR_LINE_UOM_MISMATCH`, `SERIAL_TRACKING_LOCKED`, `PRODUCT_UOM_LOCKED` (03 §1a).

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

- Một cấp phê duyệt cho PR, PO, GRR, GR, GIR `SALES_CONTRACT`, GI. **Ngoại lệ:** GIR `AVAILABLE_STOCK` hai bước Sales → Quản lý kho. HĐ không phê duyệt (`DRAFT`/`ACTIVE`/`CANCELED`).
- `approval_status`: `DRAFT`, `WAITING_FOR_APPROVE`, `APPROVED`, `REJECTED`, `CANCELED`. Thu hồi luôn về `DRAFT`.
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
