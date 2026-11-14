# Backend Architecture Audit — 2026-11-14 (PR #15, chỉ đọc)

Phạm vi: `apps/api/src` tại `main` sau PR #14 (≈ 5.000 dòng không tính test). Không sửa code, schema, migration, API hay IM31 trong PR này. Mỗi mục là đề xuất; quyết định thuộc người dùng.

## Tóm tắt

- Ranh giới **import** giữa module nhìn chung đúng ARCHITECTURE §2.1: module gọi nhau qua `*Facade` (`InventoryFacade`, `ProcurementFacade`, `SalesContractFacade`, `InboundFacade`); không import repository của module khác.
- Ranh giới **dữ liệu** yếu hơn ranh giới import: nhiều truy vấn SQL thô đọc (và một chỗ ghi) bảng của module khác. Đây là nguồn nợ kỹ thuật chính.
- Transaction và thứ tự khóa được thiết kế có chủ đích (một use case ghi = một `transaction`, `FOR UPDATE ... ORDER BY id`), có comment giải thích; không thấy vi phạm rõ ràng.
- Không có mục **Critical** (lỗi dữ liệu/bảo mật đang xảy ra).

## Phát hiện

| # | Mức | Vấn đề | Vị trí | Khuyến nghị |
|---|---|---|---|---|
| B1 | High | **IM31**: kiểm tra Thu hồi GR đọc trực tiếp `goods_issue_requests`/`goods_issues` (Outbound) và khóa `FOR UPDATE` bảng đó từ Inbound — đảo chiều đồ thị (Outbound → Inbound đã có). Đã ghi `shortcut` trong OPEN-QUESTIONS IM31 | `modules/inbound/inbound.service.ts:357-375` | Outbound duy trì dấu/bộ đếm "GIR/GI đang tham chiếu" trên dòng PR qua `ProcurementFacade` (mẫu ADR-0003), Inbound chỉ đọc dấu đó; hoặc ghi ADR chấp nhận ngoại lệ. Cần quyết định trước khi đổi điều kiện thu hồi |
| B2 | High | Inventory **ghi** bảng `goods_issue_line_allocations` và đọc `goods_issue_serials`/`goods_issues`/`goods_receipt_details` (Outbound/Inbound) | `modules/inventory/inventory.service.ts` (các truy vấn allocation, `reverseReceipt`) | Xác định chủ sở hữu bảng allocation (ADR-0013 nói "lô do GI line lấy") rồi ghi rõ trong ADR; nếu thuộc Inventory, đổi tên/ghi chú cho khớp; nếu thuộc Outbound, Outbound truyền dữ liệu vào facade |
| B3 | Medium | Sales Contracts đọc `purchase_requisitions` và `goods_issue_requests` khi Hủy HĐ (đã có `shortcut`) — trái ARCHITECTURE §2.1 (module nền tảng không đọc ngược) | `modules/sales-contracts/sales-contracts.service.ts:165-169` | Dấu tham chiếu trên HĐ do PR/GIR ghi qua `SalesContractFacade` (đúng mẫu §2.1) |
| B4 | Medium | Procurement đọc `goods_receipt_requests` khi Thu hồi/Hủy PO (đã có `shortcut`) — trái ADR-0003 | `modules/procurement/procurement.service.ts:320-321` | Dùng số tổng hợp trên dòng PO mà Inbound đã duy trì (IM25) |
| B5 | Medium | Vòng phụ thuộc file giữa Identity ↔ Master Data: `identity.entities.ts` import `Warehouse`, `master-data.controller.ts` import `identity/auth` | `modules/identity/identity.entities.ts:2` | Quan hệ user–warehouse chỉ cần `warehouse_id` (cột) hoặc chuyển decorator/guard sang `common/`; không ảnh hưởng runtime hiện tại |
| B6 | Medium | Không có công cụ kiểm tra ranh giới module phía API (ARCHITECTURE §2.1 nói "ESLint … khi scaffold" nhưng repo không có ESLint) | `apps/api` | Thêm test kiến trúc giống `apps/web/src/test/architecture.test.ts` (đọc import, không thêm dependency): module chỉ import `../<module>/<facade file>`, không vòng |
| B7 | Medium | Service lớn, nhiều trách nhiệm: `inbound.service.ts` (544 dòng: GRR + GR + khai báo SN + thu hồi), `gir.service.ts` (534), `procurement.service.ts` (411: PR + PO) | `modules/inbound`, `modules/outbound`, `modules/procurement` | Tách theo chứng từ (`grr.service.ts`, `gr.service.ts`, `gr-recall.ts`; `pr.service.ts`, `po.service.ts`) như Outbound đã làm với `gi.service.ts`; giữ một facade/module |
| B8 | Low | SQL đọc trong controller: `inventory.controller.ts` (truy vết lô, join `goods_receipts`, `sales_contracts`, `users`), `master-data.controller.ts` (khách hàng/NCC, transaction đổi Product) | `modules/inventory/inventory.controller.ts:19-60`, `modules/master-data/master-data.controller.ts:60` | Dời vào service để controller chỉ map HTTP ↔ use case (CLAUDE.md: quy tắc không ở controller). Truy vấn đọc join nhiều module chấp nhận được cho màn hình báo cáo nhưng nên gom trong một query service có tên rõ |
| B9 | Low | Đọc join hiển thị chéo module (`products`, `users`, `warehouses`, `suppliers`, `customers`, `sales_contracts`) rải trong mọi service | toàn bộ `modules/*/*.service.ts` | Chấp nhận cho read model (không ghi, không khóa); ghi nhận trong ADR-0002 là ngoại lệ "read join" để phân biệt với B1–B4 |
| B10 | Low | Facade đặt chung file với service (`InventoryFacade` trong `inventory.service.ts`), module khác import đường dẫn service | `modules/*/…service.ts` | Mỗi module có `index.ts`/`*.facade.ts` export facade, làm điểm import duy nhất (dễ kiểm tra bằng B6) |
| B11 | Low | Thứ tự khóa Thu hồi GR bắt đầu bằng GR → dòng PR → GIR → dòng PO → `inventories`…; bảng thứ tự khóa ở ARCHITECTURE §2.1a chưa liệt kê GR/dòng PO | `inbound.service.ts:338-375`, `ARCHITECTURE.md §2.1a` | Bổ sung tài liệu thứ tự khóa đầy đủ; không thấy chu trình khóa với GIR/GI hiện tại |
| B12 | Low | `BusinessError` (lỗi chung RFC 9457) nằm trong `modules/workflow/workflow.ts`, nên Master Data/Inventory phụ thuộc Workflow chỉ vì kiểu lỗi | `modules/workflow/workflow.ts:6` | Chuyển sang `common/` cạnh `ProblemDetailsFilter` |

**`common/`**: chỉ có DTO dùng chung (`SourceLineDto`, `SubmitDto`, `ReasonDto`, `CodeNameDto`, `OptionalReasonDto`) và `ProblemDetailsFilter` — không chứa logic nghiệp vụ. Ổn.

**`database/`**: migration commit theo thời gian, `synchronize` không dùng; `seed`/`seed-demo` tách riêng. Ổn.

**Integration tests**: 5 file `*.int.spec.ts` ở root `src/` (app, editing, inbound, outbound, procurement) dùng `bootTestApp` + PostgreSQL thật; tổ chức theo luồng, không theo module. Khuyến nghị (Low): dời vào `test/integration/` hoặc cạnh module khi tách service (B7), giữ tham chiếu ID nghiệm thu docs/05 trong tên test.

## Thứ tự đề xuất (PR sau, mỗi mục một PR nhỏ)

1. B6 (test kiến trúc API) — rẻ, ngăn nợ tăng thêm.
2. B12, B10, B5 — dọn phụ thuộc không đổi hành vi.
3. B7, B8 — tách file không đổi API.
4. B1–B4 — cần quyết định nghiệp vụ/ADR (dấu tham chiếu), có migration; làm sau khi người dùng duyệt.
