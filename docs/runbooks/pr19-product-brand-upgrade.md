# Nâng cấp hãng của Product — PR #19 Phase 1

1. Xác minh đích `DATABASE_URL`, PostgreSQL database, bảng migration, số Product và các FK từ HĐ/PR/PO/GRR/GR/GIR/GI/tồn kho. Chạy trên môi trường được phép. Sao lưu trước khi nâng cấp môi trường có dữ liệu.
2. Chạy `pnpm --filter api migration:run --transaction each`. Migration `PrMasterData1732838400000` tạo danh mục và FK hãng nullable để hỗ trợ cập nhật dữ liệu. Trên DB đã có Product, migration `RequireProductBrand1732924800000` dừng nếu còn dòng thiếu hãng. Chế độ `each` giữ migration nền tảng đã commit.
3. Trong một transaction, thêm hãng thực tế vào `brands` và cập nhật `products.brand_id` theo danh sách Product → hãng do người phụ trách xác nhận. Kiểm tra `SELECT id, part_number FROM products WHERE brand_id IS NULL` trả rỗng. Dừng để bổ sung dữ liệu nếu thiếu nguồn xác thực. Không suy ra hãng từ mã hoặc tạo hãng tạm cho dữ liệu cũ.
4. Chạy lại lệnh migration. Kiểm tra `products.brand_id` là `NOT NULL`, FK hợp lệ và số lượng, ID Product/dòng chứng từ giữ nguyên. Chạy seed để cấp `PROCUREMENT_CATALOG.MANAGE` cho ADMIN mặc định. Cấp quyền cho các role khác qua phân quyền.
5. Dữ liệu test cần dọn theo DEC-19-04 chỉ được xử lý trên DB test đã xác minh, theo phụ thuộc và phạm vi riêng. Hai migration không xóa dữ liệu. Không cập nhật tự động tham chiếu danh mục của các dòng HĐ cũ.
