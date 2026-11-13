# ADR-0005: Master Data và đa ngôn ngữ

- **Trạng thái:** Đã chấp nhận — 2026-11-12

## Quyết định — Master Data
- "Danh mục hàng hóa" gồm hai bảng tách biệt (cập nhật 2026-11-13):
  - `temporary_products`: mã tạm — mã, tên, mô tả; không UoM. Chỉ dùng trên dòng PR (đến khi mapping, ADR-0008).
  - `products`: mã chính (PN) — `part_number` unique, UoM, `is_serial_tracked`, thông tin kế toán dự trù, trạng thái đang dùng/ngừng dùng; tên, mô tả, model, thương hiệu/nhà sản xuất. Không dùng SKU.
- Danh mục phụ: `product_categories`, `units_of_measure`. Không thêm khi chưa có nhu cầu.
- SN thuộc Inventory, không thuộc `products`.
- Không xóa cứng mã đã phát sinh chứng từ.
- `is_serial_tracked` mặc định `true`; khóa thay đổi nếu PN từng xuất hiện trên GRR, GR, GIR hoặc GI, bất kể trạng thái (M1, T5).
- ~~Dòng HĐ chỉ dùng mã chính (T3)~~ — thay thế bởi ADR-0009: dòng HĐ lưu thông tin gốc, Product được phép giao quản lý riêng.
- Sau khi Product được dùng trên chứng từ: khóa `part_number`, tên và UoM (cùng phạm vi khóa UoM); mô tả và trạng thái hoạt động vẫn sửa được; không xóa Product (M2, 2026-11-13). PO/GRR/GR/GIR/GI không snapshot tên/mô tả.
- Kho có thuộc tính cho phép xuất hàng có sẵn (`allow_available_stock_issue`, đề xuất) — ADR-0010.
- `products.unit_of_measure_id` bị khóa khi mã chính đã xuất hiện trên PR (kể cả qua mapping), PO, GRR, GR, HĐ, GIR, GI, mọi trạng thái → `PRODUCT_UOM_LOCKED` (T9; concurrency: ADR-0008).

## Quyết định — i18n
- `vi` mặc định, `en`. Không dịch tự động.
- Giao diện: `react-i18next`, không hardcode chuỗi.
- Danh mục: bảng chính + `<entity>_translations`, unique (entity_id, `language_code`), fallback `vi`.
- Không dịch mã định danh (PN, SN, mã kho…) và tên pháp lý khách hàng/nhà cung cấp.
- Chứng từ tham chiếu product ID.

## Hệ quả
- Truy vấn danh mục cần join bản dịch theo ngôn ngữ yêu cầu + fallback.
- Dòng PR và dòng HĐ giữ thông tin hàng hóa gốc; chứng từ khác tham chiếu `product_id` (M2 đã chốt).
- `temporary_products` không có bản dịch trong MVP (T4).

## Bổ sung 2026-11-13 (đóng P2)
- Tên dịch trong `product_translations` bị khóa cùng tên Product khi Product đã được sử dụng.
