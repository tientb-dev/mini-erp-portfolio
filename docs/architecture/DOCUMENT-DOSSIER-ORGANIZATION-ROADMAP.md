# Roadmap Common Document Dossier và Organization Master Data

Phase 4.1 của PR #19 triển khai nền tảng Common Document Dossier và hai màn hình quản trị. Organization Master Data thuộc roadmap riêng.

## Common Document Dossier

Phase 4.1 cung cấp catalog, cấu hình, hàm snapshot cho transaction của module sở hữu và nền tảng metadata. Tab Hồ sơ vẫn hiển thị placeholder. Quy tắc DOSSIER-001 đến DOSSIER-009 nằm trong [Business Rules](../03-BUSINESS-RULES.md#hồ-sơ-chứng-từ).

### Phase 4.2

- Tích hợp snapshot khi PR được lưu lần đầu. Với PR có trước Phase 4 chưa có dấu mốc, đề xuất giữ trạng thái chưa khởi tạo trong View và chỉ chụp cấu hình hiện hành theo một thao tác riêng sau khi BA duyệt. Cần chốt phạm vi, quyền và thời điểm.
- Common File Attachment Cell hiển thị tên file, trạng thái tạm hoặc hiện hành và thao tác theo quyền. Tên dài dùng ellipsis và tooltip. Chọn hoặc thay file chuẩn bị upload tạm. Xóa hoặc thay thế chỉ kết thúc liên kết hiện hành khi lưu chính thức. Backend kiểm tra quyền đọc chứng từ khi tải.
- File PDF, Word, Excel, JPG và PNG lưu riêng tư trên máy chủ. Giới hạn mặc định 20 MiB, điều chỉnh qua `DOSSIER_MAX_FILE_BYTES`. Lưu hồ sơ cập nhật binding và con trỏ hiện hành trong cùng transaction. Giữ các binding đã kết thúc để truy vết và ghi Common Activity History.
- Kế thừa PR sang PO là backlog nghiệp vụ PO. Khi nhiều PR nguồn có file cùng loại, người dùng chọn file kế thừa. Metadata đã cho phép nhiều chứng từ tham chiếu cùng file vật lý và lưu provenance.

## Phạm vi PR #19 cho Đề nghị mua hàng

- Hoàn thiện Thông tin chung gồm tên đề nghị riêng, ngày cần hàng, tiền tệ, tỷ giá cấp chứng từ, mục đích đề nghị và diễn giải. Rà soát chọn HĐ bán và quy tắc liên kết dòng HĐ.
- Hoàn thiện popup hàng hóa gồm nhà cung cấp từng dòng, đơn giá, thành tiền, Master Data thuế và dropdown thuế, tiền thuế, tổng thanh toán và validation tương ứng.
- Rà soát danh sách PR gồm cột, filter, trạng thái, tổng tiền và layout.

## Organization Master Data

- Cơ cấu tổ chức theo cây. Employee và User dùng chung hồ sơ người dùng. Một User có thể thuộc nhiều bộ phận.
- Quản lý chức danh và quản lý trực tiếp qua cấu hình.
- Organization và Authorization độc lập. Cây tổ chức không cấp hoặc kế thừa quyền. Quyền và phân công được cấu hình trong cơ chế Authorization hiện có.
