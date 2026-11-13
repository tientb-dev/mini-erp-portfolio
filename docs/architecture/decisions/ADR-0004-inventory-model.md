# ADR-0004: Mô hình Inventory bốn bảng

- **Trạng thái:** Đã chấp nhận (định hướng; cột cụ thể quyết định ở ERD) — 2026-11-12, cập nhật 2026-11-12 theo quy tắc GR mới (03 §2)

> **Sửa đổi bởi ADR-0012 (2026-11-13):** tồn kho phải phân biệt lượng theo **người phụ trách nguồn hàng** (ghi nhận khi duyệt GR), không chỉ Warehouse + PN. Cách mở rộng các bảng dưới đây và cơ chế phân bổ xuất theo dòng GR/lô chưa chốt (OPEN-QUESTIONS).

## Quyết định — bảng
| Bảng | Vai trò |
|---|---|
| `inventories` | Số dư Warehouse + PN: tồn thực tế, lượng giữ chỗ bởi GI Chờ duyệt. Là dòng bị khóa khi duyệt/thu hồi GR và Gửi duyệt/Duyệt GI. |
| `inventory_transactions` | Biến động số lượng hiện hành, chỉ từ GR/GI Đã duyệt. |
| `inventory_serials` | Mỗi SN đã được ghi nhận nhập kho: PN, kho, `goods_receipt_detail_id` (record rã chi tiết GR, **không** phải `goods_receipt_lines`), trạng thái hiện tại. |
| `inventory_serial_transactions` | Lịch sử nhập/xuất từng SN. |

- GR Nháp/Chờ duyệt/Bị từ chối/Đã hủy **không** ghi gì vào bốn bảng; SN của GR chưa duyệt chỉ nằm ở `goods_receipt_details`.
- GI Chờ duyệt giữ chỗ bằng cột giữ chỗ trên `inventories` + trạng thái `inventory_serials`; không bảng reservation riêng.
- Bất biến: tồn thực tế ≥ 0; 0 ≤ giữ chỗ ≤ tồn thực tế; số dư = Σ `inventory_transactions` hiện hành.

## Quyết định — vòng đời SN và thu hồi GR (cơ chế đơn giản nhất)
1. **Unique (PN, normalized SN) trên `inventory_serials`.** Record chỉ được tạo khi Duyệt GR. Hai GR duyệt đồng thời cùng SN → unique index làm thất bại transaction thứ hai → lỗi `SN_DUPLICATE`, GR đó vẫn Chờ duyệt.
2. **SN đã nhập và xuất không tái sử dụng:** GR có SN còn được bất kỳ GI chưa Hủy tham chiếu (kể cả đã xuất) không được Thu hồi (03 §2.2, R1), nên record `inventory_serials` của SN đó tồn tại vĩnh viễn → unique index tiếp tục chặn. Không cần bảng "SN đã từng dùng" riêng.
3. **Thu hồi GR Đã duyệt:** trong một transaction, khóa `inventories` (theo thứ tự PN) và các `inventory_serials` của GR (`FOR UPDATE`), kiểm tra điều kiện, rồi **xóa** `inventory_transactions`, `inventory_serials`, `inventory_serial_transactions` phát sinh từ GR đó và trừ số dư. SN được giải phóng để GR duyệt lại (hoặc GR khác) ghi nhận.
4. **Chống ghi trùng khi retry:** chuyển trạng thái bằng `UPDATE … WHERE approval_status = <trạng thái mong đợi>`; nếu 0 dòng bị ảnh hưởng thì không ghi Inventory. Thêm unique (loại chứng từ nguồn, id dòng nguồn, loại biến động) trên `inventory_transactions`.
5. **Truy vết:** lịch sử Duyệt/Thu hồi (người, thời điểm, lý do) lưu ở cấp chứng từ (Workflow); `goods_receipt_details` không bị xóa.
6. Thứ tự khóa thống nhất cho GR và GI: `inventories` (sắp theo id) → `inventory_serials` (sắp theo id), để tránh deadlock và tranh chấp (B20). Lưu GI Nháp có chọn SN cũng khóa `inventory_serials` để tuần tự hóa với Thu hồi GR (B26).
7. **Duyệt thất bại vì trùng SN** → rollback, GR giữ Chờ duyệt (R3).
8. **Quan hệ SN (F1 = phương án C, phê duyệt 2026-11-12):** cả hai bảng tham chiếu record rã chi tiết GR:
   - `inventory_serials.goods_receipt_detail_id` → `goods_receipt_details.id` (trạng thái SN hiện hành trong Inventory).
   - `goods_issue_serials.goods_receipt_detail_id` → `goods_receipt_details.id` (SN được chọn trên GI, giữ cả khi GI Đã hủy).
   - Không dùng `inventory_serial_id` trên `goods_issue_serials` (đã loại phương án B).
   - `goods_issue_serials.serial_number`: snapshot SN lúc chọn, **chỉ để hiển thị lịch sử** (F1a, 2026-11-13); không dùng cho Inventory, kiểm tra khả dụng hay điều kiện Thu hồi.
   - `goods_receipt_details` không bao giờ bị xóa → cả hai FK luôn hợp lệ; xóa `inventory_serials` khi Thu hồi GR không bị chặn bởi GI Đã hủy.
   - Chọn SN cho GI: SN phải tồn tại và khả dụng trong `inventory_serials` (đúng Kho + PN); có `goods_receipt_details` **không** đồng nghĩa khả dụng. Kiểm tra và lưu trong cùng transaction, khóa dòng `inventory_serials` tương ứng.
   - Thu hồi GR: chặn nếu có `goods_issue_serials` của GI chưa Hủy tham chiếu tới `goods_receipt_details` của GR; GI Đã hủy không chặn; không tự gỡ SN khỏi GI.
   - `inventory_serial_transactions` của lần duyệt bị thu hồi bị xóa trước `inventory_serials`. Các FK trỏ vào bảng Inventory dùng `RESTRICT` làm lớp bảo vệ cuối.

## Phương án bị loại
- Reversal ledger (ghi bút toán đảo): đầy đủ hơn nhưng phức tạp, không cần cho MVP.
- Giữ chỗ SN ở GR Chờ duyệt bằng `inventory_serials`: đã bị loại theo nghiệp vụ.

## Hệ quả / trade-off
- `inventory_transactions` không phải sổ bất biến tuyệt đối: lần duyệt bị thu hồi biến mất khỏi Inventory; dấu vết chỉ còn ở cấp chứng từ. Chấp nhận theo định hướng MVP.
- Lịch sử SN (02 §E) chỉ hiển thị lịch sử Inventory còn hiệu lực (R2, đã chốt).
- Không reversal ledger; audit Duyệt/Thu hồi ở cấp chứng từ (I5, đã chốt).

## Ngoài phạm vi
Tồn theo người phụ trách, phân bổ theo HĐ, duyệt điều phối nhiều cấp, tồn theo location. Hàng dùng chung theo Warehouse + PN không đổi.
