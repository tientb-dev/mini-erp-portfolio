# Roadmap Common Document Dossier và Organization Master Data

Hai module dưới đây là thiết kế roadmap. Phase 1 của PR #18 chỉ cập nhật tài liệu.

## Common Document Dossier

PR #18 Phase 4.1 hiển thị trạng thái Chưa có hồ sơ trong Common Document Page. PR #19 triển khai nghiệp vụ Common Document Dossier trong tab này, cùng quyền quản lý hồ sơ riêng.

- Master Data định nghĩa loại hồ sơ theo loại chứng từ. Danh mục được chụp snapshot khi lưu chứng từ lần đầu.
- Mỗi loại hồ sơ có checkbox bản giấy độc lập với file điện tử và tối đa một file.
- Hồ sơ không bắt buộc cho workflow. Người có quyền quản lý hồ sơ riêng được cập nhật sau Done.
- PO kế thừa hồ sơ PR rồi chỉnh sửa độc lập. Khi nhiều PR nguồn có file trùng loại, người dùng chọn file kế thừa.
- Ghi nhận thay đổi hồ sơ vào Common Activity History.

## Phạm vi PR #19 cho Đề nghị mua hàng

- Hoàn thiện Thông tin chung gồm tên đề nghị riêng, ngày cần hàng, tiền tệ, tỷ giá cấp chứng từ, mục đích đề nghị và diễn giải. Rà soát chọn HĐ bán và quy tắc liên kết dòng HĐ.
- Hoàn thiện popup hàng hóa gồm nhà cung cấp từng dòng, đơn giá, thành tiền, Master Data thuế và dropdown thuế, tiền thuế, tổng thanh toán và validation tương ứng.
- Rà soát danh sách PR gồm cột, filter, trạng thái, tổng tiền và layout.

## Organization Master Data

- Cơ cấu tổ chức theo cây. Employee và User dùng chung hồ sơ người dùng. Một User có thể thuộc nhiều bộ phận.
- Quản lý chức danh và quản lý trực tiếp qua cấu hình.
- Organization và Authorization độc lập. Cây tổ chức không cấp hoặc kế thừa quyền. Quyền và phân công được cấu hình trong cơ chế Authorization hiện có.
