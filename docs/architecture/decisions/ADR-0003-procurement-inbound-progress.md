# ADR-0003: Procurement nhận tiến độ nhập từ Inbound

- **Trạng thái:** Đã chấp nhận — 2026-11-12
- **Thay thế:** phương án port interface trong bản đề xuất ban đầu

## Bối cảnh
Procurement cần: hạn mức GRR theo dòng PO, tiến độ nhập trên PO, điều kiện "không có GRR chưa Hủy" khi Thu hồi/Hủy PO Đã duyệt. Dữ liệu phát sinh ở Inbound. Inbound đã phụ thuộc Procurement (đọc dòng PO).

## Quyết định
Phụ thuộc một chiều **Inbound → Procurement**. Dòng PO (hoặc PO) lưu số lượng tổng hợp; Inbound cập nhật qua facade Procurement trong cùng transaction:
- Gửi duyệt GRR: khóa dòng PO, kiểm tra và cộng lượng cam kết nhập.
- Từ chối / Thu hồi / Hủy GRR: trừ lượng cam kết.
- Duyệt GR: cộng lượng thực nhập → tiến độ Chưa nhập / Nhập một phần / Đã nhập đủ.
- Thu hồi GR Đã duyệt (bổ sung 2026-11-12): trừ lượng thực nhập, cùng transaction với hoàn tác Inventory. Lượng cam kết GRR và số GRR chưa Hủy không đổi (GRR và GR vẫn tồn tại).
- Tạo / Hủy GRR: cập nhật số GRR chưa Hủy.

## Phương án bị loại
- Port interface do Inbound cài đặt: cần đăng ký chéo provider, dễ thành `forwardRef`.
- Event bus: thừa cho MVP, khó giữ atomic.
- Procurement truy vấn trực tiếp bảng Inbound: phá ranh giới module.

## Hệ quả
- Số tổng hợp là dữ liệu dẫn xuất → cần kiểm thử đối chiếu với Σ GRR/GR thực tế.
- Dòng PO là điểm khóa duy nhất cho hạn mức nhập, đơn giản hóa chống vượt đồng thời (B02).
