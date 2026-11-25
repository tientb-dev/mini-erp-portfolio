# ADR-0017 — Hoàn thiện nghiệp vụ PR

**Trạng thái** · Đã duyệt nghiệp vụ. Phase 1 triển khai danh mục và dòng HĐ.

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

## DEC-19-06 · Common Dossier

Phase 4 triển khai DOSSIER-001 đến DOSSIER-008 theo roadmap. Hồ sơ giấy độc lập file, hồ sơ không bắt buộc khi gửi duyệt, snapshot tại lần lưu đầu, file server local và metadata DB. File hỗ trợ PDF, Word, Excel, JPG, PNG và giới hạn mặc định 20 MB cấu hình được. Quyền xem chứng từ cho phép xem/tải, quyền quản lý riêng cho phép sửa sau Hoàn tất. Mỗi loại có tối đa một file hiện hành, giữ file cũ khi xóa hoặc thay, ghi Common Activity History. PO kế thừa và quản lý độc lập.
