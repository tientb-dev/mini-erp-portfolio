# ADR-0017 — Hoàn thiện nghiệp vụ PR

**Trạng thái** · Phase 1 triển khai danh mục và dòng HĐ. Phase 2 triển khai backend PR theo DEC-19-01 đến DEC-19-05, DEC-19-07 và DEC-19-08.

## DEC-19-01 · Trùng mã

Cho phép lặp mã chính và mã tạm trên chứng từ, kể cả cùng NCC. Hiển thị cảnh báo mềm khi grid có mã trùng và tự bỏ khi hết trùng. Dòng lưu theo ID, có thể lưu ngay, không gộp và không đặt khóa duy nhất theo mã hoặc mã + NCC. Picker tiếp tục hiển thị mục đã chọn và NCC đã dùng. Hạn mức và liên kết nguồn giữ theo ID dòng. Mỗi dòng PO xuất hiện tối đa một lần trong cùng GRR, có thể nhập nhiều đợt.

## SC-LINE-INPUT-001 · Dòng HĐ

Dòng HĐ có đúng một cách nhập gồm mã chính, mã tạm hoặc nhập tự do. Hai FK danh mục có thể cùng rỗng và không được cùng có giá trị. Snapshot mã, tên, mô tả, ĐVT và số lượng được giữ trên chứng từ. Nhập tự do không sinh bản ghi danh mục. Dòng HĐ cũ tiếp tục là dòng nhập tự do; trùng chuỗi không phải căn cứ backfill tham chiếu. Chọn mã trên HĐ không tạo đề xuất hoặc phê duyệt Product được phép giao.

## DEC-19-02 · Liên kết nhu cầu

Cả hai loại PR thuộc một HĐ bán ACTIVE và chọn từ toàn bộ danh mục. Dòng PR hàng bán cần một dòng HĐ trước Gửi duyệt; Vật tư tùy chọn. Một dòng HĐ có thể liên kết nhiều dòng PR. Gợi ý khi đúng một dòng HĐ cùng định danh và loại danh mục. Dòng nhập tự do, không có ứng viên hoặc nhiều ứng viên phải chọn tay. Người tạo có thể thay đổi; người duyệt và người tiếp nhận kiểm tra. Chứng từ sau kế thừa liên kết theo dòng nguồn. Ủy quyền giao Product vẫn theo ADR-0009.

## DEC-19-03 · Mã tạm

HĐ, PR và PO theo mô hình mục tiêu dùng được mã tạm. PR chứa cả hai loại mã và hoàn tất qua workflow hiện có. Trong PR #19, dòng mã tạm chưa lập PO được và cần lý do rõ ràng; dòng mã chính cùng PR vẫn lập được PO. GRR phải xác định mã chính trước Gửi duyệt và giữ mã trên chứng từ nguồn. Tồn kho chỉ có mã chính. Xem ADR-0008.

## DEC-19-04 · Dữ liệu test

Chỉ dọn dữ liệu phát triển hoặc test đã xác minh, khi cần và theo quan hệ phụ thuộc. Giữ danh mục, quyền, tài khoản, cấu hình workflow và dòng HĐ nhập tự do hợp lệ. Không tạo dữ liệu giả để lấp hãng thiếu. Các Product hiện hữu phải được gán hãng đã xác minh trước migration ràng buộc bắt buộc. Xem [runbook nâng cấp](../../runbooks/pr19-product-brand-upgrade.md).

## DEC-19-05 · Tiền tệ và giá mua

Tiền tệ và thuế thuộc Master Data. PR có một tiền tệ (mặc định VND) và một tỷ giá, theo VND trên một đơn vị ngoại tệ. Mặc định lấy Master Data. Checkbox Nhập tỷ giá thủ công cho phép ghi đè; bỏ chọn trả về tỷ giá danh mục. VND luôn bằng 1. Snapshot tỷ giá, nguồn tỷ giá và dữ liệu tài chính. Backend tính bằng decimal chính xác.

Đơn giá PR là hạn mức mua trước thuế theo dòng, mặc định 0, nháp chấp nhận 0 và Gửi duyệt yêu cầu lớn hơn 0. Không có đơn giá âm. Giá bán HĐ không cung cấp đơn giá PR. PO về sau kiểm tra hạn mức theo ID dòng với cùng ĐVT, tiền tệ và cơ sở trước thuế. Tăng hạn mức cần điều chỉnh PR và phê duyệt lại; xử lý trong giai đoạn PO.

PO hiện có số lượng, NCC và ĐVT. Để khóa hạn mức cần bổ sung đơn giá mua trước thuế, tiền tệ, cơ sở so sánh và kiểm tra ở backend trên từng dòng nguồn khi lập, sửa, gửi và duyệt PO. Phase 2 cung cấp hạn mức và căn cứ của PR cho phần nghiệp vụ PO.

## DEC-19-06 · Common Dossier

Áp dụng DOSSIER-001 đến DOSSIER-009 trong [Business Rules](../../03-BUSINESS-RULES.md#hồ-sơ-chứng-từ). Phase 4.1 cung cấp nền tảng dữ liệu, snapshot và màn hình quản trị. Phạm vi PR và Common File Attachment Cell được mô tả trong [roadmap](../DOCUMENT-DOSSIER-ORGANIZATION-ROADMAP.md).

Phase 4.2 tích hợp snapshot trong lần lưu PR mới đầu tiên. BA chốt PR cũ giữ danh sách trống; luồng đọc hoặc sửa PR cũ không tạo snapshot. Cập nhật Hồ sơ trong View dùng phiên bản dòng độc lập và không đổi workflow PR.

## DEC-19-07 · Tính tiền chứng từ ERP

Giới hạn phân số và thứ tự làm tròn theo [Business Rules §1d](../../03-BUSINESS-RULES.md#1d-tính-tiền-chứng-từ-erp). Backend dùng Decimal chính xác với `ROUND_HALF_UP` và snapshot cấu hình tiền tệ. Phase 2 dùng cách tính chung cho PR.

## DEC-19-08 · HĐ bán bắt buộc khi lưu Nháp PR

Hàng bán và Vật tư đều cần HĐ bán ACTIVE hợp lệ và tối thiểu một dòng hợp lệ ngay khi lưu Nháp. Backend kiểm tra phạm vi và quyền tạo theo PR #18. Khi Gửi duyệt áp dụng thêm các điều kiện của Header, dòng và workflow. Cơ chế phân quyền theo HĐ giữ nguyên.
