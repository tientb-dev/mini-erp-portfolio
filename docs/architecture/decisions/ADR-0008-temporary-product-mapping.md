# ADR-0008: Mã tạm, snapshot dòng PR và mapping sang mã chính

- **Trạng thái:** Đã chấp nhận — 2026-11-13 (cập nhật cùng ngày: T1–T6, N2, I7)
- **Đóng:** Q1, U5, T1–T6, N2, I7 (OPEN-QUESTIONS)

## Bối cảnh
PR được lập trước khi hàng có mã chính. PO/GRR cần xác định mã chính trước khi nhập kho; Inventory chỉ làm việc với mã chính.

## Quyết định
- Hai bảng tách biệt: `temporary_products` (mã, tên, mô tả; không UoM; không bản dịch) và `products` (ADR-0005).
- Dòng PR (`purchase_requisition_lines`) lưu snapshot mã, tên, mô tả, UoM ban đầu. Mã tạm → chọn UoM từ dropdown; mã chính → UoM từ `products`.
- `purchase_requisition_lines.product_id` nullable = kết quả chuẩn hóa **dùng chung**; PO/GRR đọc mã chính qua dòng PR, không giữ bản mapping riêng.
- Mapping chỉ mã tạm → mã chính, **một lần**, theo **từng dòng PR**, trực tiếp trên PO hoặc GRR ở `DRAFT`, bằng quyền sửa chứng từ đó; không thông báo riêng. Không đổi lần hai; không đổi mã chính → mã chính. Mã tạm vẫn được tái sử dụng.
- **Ngoại lệ có chủ đích (I7):** mapping dùng chung có thể đổi thông tin hàng hóa hiển thị trên chứng từ `APPROVED`; không được sửa trực tiếp số lượng hoặc nội dung đã duyệt.
- **Không quy đổi UoM (T1).** Dòng PO kế thừa UoM snapshot dòng PR, dòng GRR kế thừa UoM dòng PO; mỗi dòng lưu UoM riêng (T7). Mapping không đổi UoM/số lượng. Hạn mức Σ PO ≤ PR, Σ GRR ≤ PO chỉ so sánh cùng UoM.
- **Chặn mapping sớm (T8):** UoM mã chính phải bằng UoM dòng PR và UoM mọi dòng PO tham chiếu dòng PR (kể cả `APPROVED`); nếu không → `MAPPING_UOM_MISMATCH`.
- Gửi duyệt GRR vẫn kiểm tra UoM dòng GRR = UoM mã chính (`GRR_LINE_UOM_MISMATCH`) làm lớp bảo vệ, kể cả khi đã sửa số lượng. Điều chỉnh PO, quy đổi UoM: ngoài MVP.
- GRR `DRAFT` được giữ mã tạm; Gửi duyệt GRR yêu cầu mọi dòng có mã chính. GR, GIR, GI, Inventory chỉ dùng mã chính. (Dòng HĐ: thay thế bởi ADR-0009.)
- Auto Mapping hàng loạt: ngoài MVP.

## Concurrency
- Mapping trong một transaction: khóa dòng PR (`pessimistic_write`) → kiểm tra PO/GRR `DRAFT` (`DOCUMENT_NOT_DRAFT`), `product_id IS NULL` (`PRODUCT_ALREADY_MAPPED`), UoM mã chính = UoM dòng PR = UoM mọi dòng PO liên quan (`MAPPING_UOM_MISMATCH`) → `UPDATE … WHERE product_id IS NULL`.
- **Khóa UoM mã chính (T9):** sửa `products.unit_of_measure_id` khóa dòng `products` (`pessimistic_write`) rồi kiểm tra mã chính chưa xuất hiện trên PR (đã mapping hoặc chọn trực tiếp), PO, GRR, GR, HĐ, GIR, GI ở mọi trạng thái; vi phạm → `PRODUCT_UOM_LOCKED`. Mapping và mọi thao tác ghi thêm tham chiếu tới mã chính vào dòng chứng từ khóa dòng `products` đó ở chế độ `pessimistic_read` (`FOR SHARE`) trước khi đọc UoM → sửa UoM và mapping/thêm dòng luôn tuần tự.
- Thứ tự khóa trong mapping: dòng PR → dòng `products` (cố định để tránh deadlock).
- Tạo/sửa dòng PO từ dòng PR cũng khóa dòng PR (hạn mức Σ PO ≤ PR) → không có dòng PO mới khác UoM chen vào giữa kiểm tra và cập nhật mapping.
- Gửi duyệt GRR đọc `product_id` và so UoM trong cùng transaction đã khóa dòng PO (ADR-0003).

## Ranh giới module
- `temporary_products` thuộc Master Data; `purchase_requisition_lines` thuộc Procurement. Mapping là use case của Procurement; Inbound (GRR) gọi facade Procurement — đúng chiều Inbound → Procurement (ADR-0003).

## Hệ quả
- Dòng PR có UoM khác mọi mã chính phù hợp sẽ không mapping được trong MVP; cần tạo mã chính đúng UoM hoặc chờ nghiệp vụ điều chỉnh (ngoài MVP).
- Với khóa UoM (T9), `GRR_LINE_UOM_MISMATCH` trở thành lớp bảo vệ cuối, bình thường không xảy ra; vẫn giữ kiểm tra ở backend.
