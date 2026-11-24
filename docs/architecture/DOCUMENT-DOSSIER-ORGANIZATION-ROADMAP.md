# Roadmap Common Document Dossier và Organization Master Data

Hai module dưới đây là thiết kế roadmap. Phase 1 của PR #18 chỉ cập nhật tài liệu.

## Common Document Dossier

- Master Data định nghĩa loại hồ sơ theo loại chứng từ. Danh mục được chụp snapshot khi lưu chứng từ lần đầu.
- Mỗi loại hồ sơ có checkbox bản giấy độc lập với file điện tử và tối đa một file.
- Hồ sơ không bắt buộc cho workflow. Người có quyền quản lý hồ sơ riêng được cập nhật sau Done.
- PO kế thừa hồ sơ PR rồi chỉnh sửa độc lập. Khi nhiều PR nguồn có file trùng loại, người dùng chọn file kế thừa.
- Ghi nhận thay đổi hồ sơ vào Common Activity History.

## Organization Master Data

- Cơ cấu tổ chức theo cây. Employee và User dùng chung hồ sơ người dùng. Một User có thể thuộc nhiều bộ phận.
- Quản lý chức danh và quản lý trực tiếp qua cấu hình.
- Organization và Authorization độc lập. Cây tổ chức không cấp hoặc kế thừa quyền. Quyền và phân công được cấu hình trong cơ chế Authorization hiện có.
