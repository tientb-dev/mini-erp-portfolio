# ADR-0008 — Mã tạm và mã chính thực nhận

**Trạng thái** · Cập nhật theo DEC-19-03. Phase 1 chỉ triển khai Master Data và dòng HĐ.

- `temporary_products` thuộc Master Data. Mã tạm có mã, tên và mô tả, không có hãng hoặc ĐVT.
- HĐ dùng mã tạm hoặc mã chính để điền nhanh snapshot theo SC-LINE-INPUT-001. PR chọn danh mục, có thể trộn hai loại mã và hoàn tất theo workflow hiện hành.
- PO theo mô hình mục tiêu có thể giữ mã tạm. Trong PR #19, chỉ dòng PR mã chính được lập PO. Nêu lý do khi chưa hỗ trợ tạo PO từ dòng mã tạm.
- GRR phải có mã chính trước Gửi duyệt. Xác định mã chính trên GRR, giữ nguyên danh mục mã tạm và nội dung chứng từ nguồn. Một dòng PO xuất hiện tối đa một lần trong mỗi GRR, được nhập qua nhiều GRR trong hạn mức.
- ĐVT kế thừa PR → PO → GRR, số lượng được kiểm tra theo ID dòng nguồn. Mã chính thực nhận phải cùng ĐVT với dòng GRR; không tự quy đổi.
- GR, GIR, GI và tồn kho dùng mã chính. Liên kết PR → PO → GRR → GR giữ nguyên khi xác định hàng thực nhận.
- Chọn mã chính thực nhận và xác nhận Product được phép giao trên dòng HĐ là hai use case độc lập.
- Module sở hữu chứng từ kiểm tra trạng thái, quyền và nguồn trong transaction. Master Data khóa hoặc đánh dấu Product đã sử dụng qua facade để tuần tự với cập nhật ĐVT, mã, tên và cờ SN. Inbound gọi Procurement theo ADR-0003.

Xem [ADR-0017](ADR-0017-pr-business-completion.md) cho phạm vi phát hành.
