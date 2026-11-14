# Runbook: chỉ định Sales phụ trách cho HĐ `ACTIVE` cũ

**Bối cảnh:** migration `1731801600000-ResponsibleSales` thêm `sales_contracts.responsible_sales_user_id` và CHECK `chk_sales_contracts_responsible_sales` (`status <> 'ACTIVE' OR responsible_sales_user_id IS NOT NULL`) ở dạng **`NOT VALID`**. HĐ có sẵn để `NULL` — **không** mặc định người tạo (IM24). HĐ `ACTIVE` không sửa được qua ứng dụng, nên HĐ cũ phải được chỉ định bằng script này.

## `NOT VALID` nghĩa là gì
- PostgreSQL **kiểm tra mọi dòng được INSERT/UPDATE** sau migration, nhưng **không kiểm tra dòng đã có**.
- HĐ `ACTIVE` cũ chưa có Sales vẫn đọc được; Hủy được (dòng mới có `status = 'CANCELED'`, thỏa CHECK).
- Bất kỳ `UPDATE` nào giữ HĐ cũ ở `ACTIVE` mà vẫn `NULL` sẽ lỗi. Hiện ứng dụng chỉ `UPDATE sales_contracts` khi sửa `DRAFT`, chốt (`DRAFT → ACTIVE`, bắt buộc có Sales) và Hủy — không đụng trường hợp này.
- Khi `convalidated = false`, planner không dùng CHECK để suy luận; không ảnh hưởng tính đúng.

## Quy trình
1. **Kiểm tra** (chỉ đọc):
   ```sh
   docker compose exec -T postgres psql -U mini_erp -d mini_erp -f - < apps/api/src/database/scripts/responsible-sales-check.sql
   ```
   Mục 1 liệt kê HĐ `ACTIVE` chưa có Sales (kèm người tạo chỉ để tham khảo, **không** dùng làm giá trị gán).
2. **Xác nhận nghiệp vụ:** người phụ trách nghiệp vụ duyệt danh sách `số HĐ → username Sales`. Lưu bằng chứng (email/ticket).
3. **Backfill:** sao chép `apps/api/src/database/scripts/responsible-sales-backfill.sql` ra ngoài repo, điền `VALUES`, chạy với `-v ON_ERROR_STOP=1`. Script chạy trong một transaction và **rollback toàn bộ** nếu:
   - còn dòng mẫu `__EDIT_ME__`;
   - HĐ không tồn tại, không `ACTIVE`, hoặc **đã có** Sales (không ghi đè);
   - Sales không đang hoạt động hoặc không có `SALES_CONTRACT.CREATE` (cùng quy tắc API).
   Có thể chạy nhiều đợt. Không commit file đã điền (có thể chứa dữ liệu thật).
4. **Kiểm tra lại** bằng bước 1: mục 1 phải rỗng.
5. **Validate constraint** — chỉ khi mục 1 trả **0 dòng**:
   ```sql
   ALTER TABLE sales_contracts VALIDATE CONSTRAINT chk_sales_contracts_responsible_sales;
   ```
   Lệnh chỉ giữ khóa `SHARE UPDATE EXCLUSIVE` (không chặn đọc/ghi thông thường); thất bại nếu còn dòng vi phạm, không đổi dữ liệu.

## Điều kiện trước PR 3 (`inventory_lots`)
Lô ghi Sales phụ trách từ HĐ nguồn khi Duyệt GR. Migration `1731974400000-InventoryLots` kiểm tra và chạy `VALIDATE CONSTRAINT` ở `up`: nếu còn HĐ `ACTIVE` chưa có Sales (hoặc GR Đã duyệt từ HĐ chưa có Sales), migration **dừng có chủ đích**, liệt kê số HĐ, không đổi dữ liệu. Làm runbook này rồi chạy lại `pnpm migrate`. Sau migration, đối soát bằng `apps/api/src/database/scripts/inventory-reconcile.sql` (kỳ vọng 0 dòng). Môi trường demo có thể reset seed thay thế (seed demo chỉ định Sales tường minh).
