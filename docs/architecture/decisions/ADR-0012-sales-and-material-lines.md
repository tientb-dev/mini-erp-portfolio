# ADR-0012: Dòng hàng bán và dòng vật tư trên PR/GIR

- **Trạng thái:** Đã chấp nhận — 2026-11-13
- **Sửa đổi:** ADR-0009 ("Dòng PR và dòng GIR tham chiếu `sales_contract_line_id`"), ADR-0010 (phạm vi hạn mức), 01 §3.4/§5, 03 §1, §3 (quy tắc "cả hai loại GIR đều bắt buộc dòng HĐ").

## Bối cảnh
Ngoài hàng bán theo dòng HĐ, dự án còn cần mua và xuất **vật tư/phụ kiện triển khai hoặc dự phòng** cho HĐ. Các vật tư này không tương ứng với dòng HĐ nào; ép chúng vào một dòng HĐ sẽ làm sai hạn mức giao hàng và sai nghĩa Product được Sales xác nhận.

## Quyết định
1. **PR và GIR gắn HĐ ở cấp chứng từ** (một HĐ `ACTIVE`). Quan hệ dòng → `sales_contract_line_id` chỉ bắt buộc với **dòng hàng bán**.
2. **Dòng hàng bán** (`sales_contract_line_id` có giá trị):
   - PR mua để bán **bắt đầu từ màn hình HĐ**: người dùng chọn các dòng HĐ để map sang PR. **Không có chức năng tách/nhân đôi dòng**: mỗi dòng PR giữ đúng `sales_contract_line_id` gốc của dòng HĐ đã chọn.
   - GIR hàng bán tham chiếu dòng HĐ; giữ nguyên điều kiện Product được Sales xác nhận (ADR-0009) và hạn mức giao theo dòng HĐ (ADR-0010).
3. **Dòng vật tư** (vật tư/phụ kiện triển khai/dự phòng; `sales_contract_line_id` rỗng):
   - PR vật tư **tạo trực tiếp từ màn hình PR**: chọn HĐ và Product.
   - GIR vật tư: chọn HĐ và vật tư trong kho; **không** bắt buộc vật tư được mua từ PR của HĐ đó (tồn dùng chung theo Kho + PN, 03 §5).
   - Không áp dụng điều kiện Product được Sales xác nhận cho dòng HĐ và không chiếm hạn mức dòng HĐ (hạn mức ADR-0010 chỉ tồn tại theo `sales_contract_line_id`).
4. **Trùng Product không đồng nghĩa trùng dòng HĐ.** Hệ thống không tự suy ra `sales_contract_line_id` từ Product (kể cả khi Product đó đã được Sales xác nhận cho một dòng HĐ), không tự chuyển dòng vật tư thành dòng hàng bán và ngược lại.
5. Giữ nguyên: phê duyệt (một cấp; GIR `AVAILABLE_STOCK` hai bước), phạm vi kho, SN, Inventory, audit, phân quyền, mapping mã tạm → mã chính (ADR-0008), đánh số/không xóa (ADR-0011).

## Hệ quả
- Kiểm tra "dòng HĐ thuộc đúng HĐ của chứng từ" vẫn áp dụng cho dòng hàng bán (A34, C01).
- Khóa dòng HĐ (`pessimistic_write`, ARCHITECTURE §2.1a) chỉ cần với dòng hàng bán; điểm khóa HĐ khi tạo chứng từ tham chiếu (khóa nội dung/Hủy HĐ) áp dụng cho mọi PR/GIR.
- Lịch sử SN: nguồn xuất GIR → GI → HĐ vẫn đầy đủ vì HĐ gắn ở cấp chứng từ.
- Có cần cột phân loại dòng tường minh hay chỉ dựa vào `sales_contract_line_id`: chưa chốt (CM4).

## Chưa chốt
OPEN-QUESTIONS §1 (CM1–CM6). Không triển khai theo giả định.
