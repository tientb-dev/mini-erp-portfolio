# Roadmap Common Document Dossier và Organization Master Data

Phase 4.1 của PR #19 triển khai nền tảng Common Document Dossier và hai màn hình quản trị. Organization Master Data thuộc roadmap riêng.

## Common Document Dossier

Phase 4.1 cung cấp catalog, cấu hình, hàm snapshot cho transaction của module sở hữu và nền tảng metadata. Phase 4.2 tích hợp hồ sơ vào PR. Quy tắc DOSSIER-001 đến DOSSIER-009 nằm trong [Business Rules](../03-BUSINESS-RULES.md#hồ-sơ-chứng-từ).

### Phase 4.2

- BA chốt PR tồn tại trước khi tích hợp giữ hồ sơ trống. PR mới snapshot khi lưu nháp hoặc gửi duyệt trực tiếp lần đầu. Revision của màn hình Create bao gồm phiên bản cấu hình và nội dung snapshot thực tế. Sau xung đột, người dùng có thể tải lại cấu hình và giữ thay đổi của các loại còn áp dụng. Dữ liệu loại đã bị loại trừ chỉ bỏ sau xác nhận.
- Common File Attachment Cell hiển thị tên file, trạng thái tạm hoặc hiện hành và thao tác theo quyền. Tên dài dùng ellipsis và tooltip. Chọn hoặc thay file chuẩn bị upload tạm. Xóa hoặc thay thế chỉ kết thúc liên kết hiện hành khi lưu chính thức. Backend kiểm tra quyền đọc chứng từ khi tải.
- HĐ bán Phase 5.2.3 dùng một file tùy chọn ở Thông tin chung, theo Business Rules §9. Tái sử dụng Common File Attachment Cell, policy và staged storage; HĐ khóa chỉ còn xem/tải. Phương án lưu một liên kết atomic với HĐ và retention chờ review kỹ thuật Phase A.
- File PDF, Word, Excel, JPG và PNG lưu riêng tư trên máy chủ. Giới hạn mặc định 20 MiB, điều chỉnh qua `DOSSIER_MAX_FILE_BYTES`. Lưu hồ sơ cập nhật binding và con trỏ hiện hành trong cùng transaction. Giữ các binding đã kết thúc để truy vết và ghi Common Activity History.
- File tạm có thời hạn 24 giờ, gắn với người tải lên, phiên tạo/sửa, PR hiện có nếu áp dụng và loại hồ sơ. Procurement giữ khóa dòng PR khi lưu, kiểm tra version từng hồ sơ và khóa metadata file khi nhận file tạm. Activity History lưu giá trị trước/sau và tham chiếu file. Lưu View không tăng version workflow.
- Docker Compose hiện chạy PostgreSQL với volume `pgdata`. API chạy trên host, mặc định giữ file tại `.local/dossiers` trong workspace. Khi chạy API trong container, đặt `DOSSIER_STORAGE_DIR` tới volume riêng bền vững và bảo đảm các bản sao API dùng chung kho lưu trữ. Sao lưu kho file cùng DB.
- Khóa file UUID do server sinh. File được ghi độc quyền và đồng bộ xuống đĩa trước khi tạo metadata tạm. Metadata ngày phát hành, người phát hành và ghi chú độc lập với cờ Có bản giấy. API xác thực từng trường tùy chọn và giữ giá trị hiện có khi không gửi trường đó. Job dọn hằng giờ xóa file tạm hết hạn theo lô và đối soát file mồ côi cũ hơn 24 giờ. Liên kết lịch sử giữ file cũ. Khi lỗi giữa DB và filesystem, đối soát dọn file chưa có metadata; lần lưu chính thức kiểm tra file vẫn tồn tại dưới khóa DB trước khi tạo liên kết.
- Kế thừa PR sang PO là backlog nghiệp vụ PO. Khi nhiều PR nguồn có file cùng loại, người dùng chọn file kế thừa. Metadata đã cho phép nhiều chứng từ tham chiếu cùng file vật lý và lưu provenance.

## Phạm vi PR #19 cho Đề nghị mua hàng

- Hoàn thiện Thông tin chung gồm tên đề nghị riêng, ngày cần hàng, tiền tệ, tỷ giá cấp chứng từ, mục đích đề nghị và diễn giải. Rà soát chọn HĐ bán và quy tắc liên kết dòng HĐ.
- Hoàn thiện popup hàng hóa gồm nhà cung cấp từng dòng, đơn giá, thành tiền, Master Data thuế và dropdown thuế, tiền thuế, tổng thanh toán và validation tương ứng.
- Rà soát danh sách PR gồm cột, filter, trạng thái, tổng tiền và layout.

## Organization Master Data

- Cơ cấu tổ chức theo cây. Employee và User dùng chung hồ sơ người dùng. Một User có thể thuộc nhiều bộ phận.
- Quản lý chức danh và quản lý trực tiếp qua cấu hình.
- Organization và Authorization độc lập. Cây tổ chức không cấp hoặc kế thừa quyền. Quyền và phân công được cấu hình trong cơ chế Authorization hiện có.
