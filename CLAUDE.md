# CLAUDE.md

## Bối cảnh dự án
Mini ERP MVP (dự án portfolio): hợp đồng bán hàng, mua hàng, chứng từ nhập/xuất kho, tồn kho, serial number, phê duyệt một cấp (ngoại lệ: GIR `AVAILABLE_STOCK` hai bước Sales → Quản lý kho, ADR-0010).
- **Tech stack đã chốt:** NestJS + TypeScript, React + TypeScript, PostgreSQL, **TypeORM**, **MUI** + MUI X Data Grid Community, `react-i18next` (`vi` mặc định, `en`), pnpm workspaces. **Modular Monolith**: một API, một ứng dụng web, một database. Không dùng microservices, message broker, distributed transaction, Drizzle, Ant Design.
- **Giai đoạn hiện tại:** tài liệu 01–05 là MVP baseline; đang implementation theo vertical slice (đã có: auth/RBAC, Product, Warehouse, Inventory, HĐ (kèm đề xuất/xác nhận Product), PR, PO, GRR, GR, GIR, GI đều có UI; Nest module theo module nghiệp vụ). Lệnh chạy/test: `README.md`. Assumption implementation ghi ở `OPEN-QUESTIONS.md` §3.
- Phiên bản ghim có chủ đích: NestJS 11 (Nest 12 chỉ ESM, Jest không nạp được), TypeScript 5.9 (TS 7 không tương thích ts-node/ts-jest).

## Quy ước ngôn ngữ
- Luôn trao đổi, giải thích, đặt câu hỏi và báo cáo kết quả bằng tiếng Việt.
- Tài liệu nghiệp vụ, tài liệu kiến trúc và giao diện người dùng ưu tiên tiếng Việt.
- Tên class, function, variable, database table, column, API endpoint và Git commit message dùng tiếng Anh.
- Code comments ưu tiên tiếng Anh.
- Không tự ý dịch hoặc thay đổi các thuật ngữ nghiệp vụ đã chuẩn hóa.
- Khi yêu cầu chưa rõ, trình bày vấn đề bằng tiếng Việt, không tự suy diễn nghiệp vụ.

## Nguồn sự thật
Tài liệu nghiệp vụ là căn cứ cao nhất — đọc các mục liên quan trước khi triển khai bất cứ thứ gì:
- `docs/01-MVP-SCOPE.md` — phạm vi, thuật ngữ, quy ước đặt tên
- `docs/02-BUSINESS-FLOWS.md` — luồng HĐ→PR→PO→GRR→GR, GIR→GI, lịch sử SN
- `docs/03-BUSINESS-RULES.md` — hạn mức, vòng đời chứng từ, tồn kho, đồng thời ("Đã chốt" và "Cần làm rõ")
- `docs/04-PERMISSIONS.md` — phê duyệt, quyền xem, phạm vi kho, thông báo
- `docs/05-ACCEPTANCE-TESTS.md` — kịch bản nghiệm thu theo ID (A01…F)
- `docs/architecture/OPEN-QUESTIONS.md` — các quyết định chưa chốt

Giữ nguyên thuật ngữ: HĐ, PR, PO, GRR, GR, GIR (`SALES_CONTRACT` / `AVAILABLE_STOCK`), GI, PN, SN, Warehouse. Không đổi tên (ví dụ: không bao giờ dùng "SKU").

## Quy tắc kiến trúc
- Các module: Identity & Access, Master Data, Sales Contracts, Procurement, Inbound, Outbound, Inventory, Workflow & Notifications. Đồ thị phụ thuộc ở ARCHITECTURE.md §3.2 — phải luôn không có vòng lặp.
- Các module chỉ giao tiếp qua facade service được export. Không bao giờ import repository hoặc service nội bộ của module khác.
- Procurement không được import Inbound; Inbound cập nhật số tổng hợp trên dòng PO qua facade Procurement (ADR-0003). Inventory không bao giờ import Inbound/Outbound.
- Inventory theo mô hình bốn bảng (ADR-0004): chỉ GR/GI Đã duyệt sinh biến động; GI Chờ duyệt chỉ giữ chỗ; GR Chờ duyệt không giữ chỗ SN; Thu hồi GR Đã duyệt hoàn tác Inventory theo 03 §2.2.
- Danh mục hàng hóa: `temporary_products` (mã tạm) tách khỏi `products` (mã chính); mapping mã tạm → mã chính một lần qua `purchase_requisition_lines.product_id` (ADR-0008). Mã "Chờ duyệt" là `WAITING_FOR_APPROVE`.
- Phân quyền: User → Role → Permission `FUNCTION.ACTION` + phạm vi kho; business rules kiểm tra riêng (ADR-0006).
- TypeORM: transaction tường minh, `pessimistic_write` trên dòng giới hạn, `@VersionColumn` cho chứng từ đang sửa, migration commit trong repo, không `synchronize: true` (ARCHITECTURE §1.1).
- Quy tắc nghiệp vụ nằm trong `domain/` / application service — không đặt trong controller hay React component.
- Một use case ghi dữ liệu = một transaction (đọc thông thường không cần). Đổi trạng thái, kiểm tra lại hạn mức, giữ chỗ tồn/SN và tạo thông báo phải commit cùng nhau.
- Khóa các dòng giới hạn (`FOR UPDATE`) theo thứ tự xác định; có ràng buộc database làm lớp bảo vệ cuối.
- Gọi đồng bộ trong cùng tiến trình. Không dùng event bus/outbox trừ khi chứng minh được nhu cầu thực tế và được phê duyệt.

## Quy ước phát triển
- TypeScript `strict`; không dùng `any` nếu không có comment giải thích lý do.
- Database: `snake_case`, tên bảng số nhiều, khóa chính `id`, khóa ngoại `<entity>_id`, `document_number`, `approval_status`, bảng dòng có hậu tố `_lines`.
- API: REST, JSON, có tài liệu OpenAPI. Lỗi trả về theo RFC 9457 Problem Details với `code` nghiệp vụ ổn định. Sửa trên dữ liệu đã cũ → 409.
- Kiểm thử: quy tắc domain có unit test; quy tắc hạn mức/tồn kho/SN/đồng thời được kiểm thử trên PostgreSQL thật; E2E test tham chiếu ID nghiệm thu trong tài liệu 05.
- Cập nhật tài liệu khi hành vi hoặc kiến trúc thay đổi; ghi lại quyết định quan trọng dưới dạng ADR trong `docs/architecture/decisions/`.

## Bảo vệ nghiệp vụ
- Không bao giờ tự đặt quy tắc cho các mục "Cần làm rõ" / "Chưa chốt" / "Tạm hoãn". Hãy hỏi, hoặc ghi rõ đó là giả định.
- Người tạo không tự duyệt chứng từ của mình; người duyệt không sửa nội dung; GI Đã duyệt bất biến; GR Đã duyệt chỉ thay đổi qua Thu hồi theo 03 §2.2.
- Không xóa chứng từ (chỉ `CANCELED`); `document_number` bất biến (ADR-0011). Hạn mức GIR theo `sales_contract_line_id` (ADR-0010).
- Kiểm tra quyền theo loại chứng từ và theo kho ở phía server cho mọi thao tác đọc và ghi (kể cả lịch sử SN — không làm lộ sự tồn tại của SN).
- Không âm tồn thực tế, không giữ chỗ âm hoặc vượt tồn, không trùng PN+SN (sau chuẩn hóa), không tính trùng lượng đã xuất và lượng đang giữ chỗ.
- Kiểm tra lại hạn mức và tồn kho tại thời điểm Gửi duyệt và Duyệt, không chỉ trên giao diện.

## Quản lý thay đổi
- Giải thích trade-off trước khi thay đổi lớn; chờ phê duyệt.
- Không bao giờ âm thầm sửa tài liệu hoặc quy tắc nghiệp vụ; chỉ đề xuất thay đổi.
- Không mở rộng phạm vi MVP khi chưa được phê duyệt.
- **Không commit hoặc push khi chưa có sự cho phép rõ ràng của người dùng.**

## Git / Pull Request
- Mọi thay đổi code đi qua feature branch + PR theo skill `/feature-pr` (`.claude/skills/feature-pr/SKILL.md`). Không làm việc trực tiếp trên `main`.
- Tên branch: `feat|fix|refactor|docs|test|chore/<mo-ta-ngan>`; commit theo Conventional Commits (tiếng Anh), mỗi commit một ý.
- Trước commit: kiểm tra secrets (`.env` bị ignore, không có mật khẩu/token trong diff), chạy `pnpm test` + `pnpm build`, self-review `git diff`.
- Mặc định **không** commit, push, tạo PR online hay merge khi chưa có đồng ý rõ ràng trong lượt đó. Không `--force`, không `--no-verify`, không ghi đè thay đổi chưa commit của người dùng.
- PR description theo `.github/pull_request_template.md`.

## Frontend (khi bắt đầu)
Mọi chuỗi giao diện qua `react-i18next`, không hardcode; không dịch PN, SN, mã định danh. Ưu tiên tính dễ dùng của ứng dụng doanh nghiệp: bảng dữ liệu dày đặc nhưng dễ đọc, nhãn trạng thái rõ ràng, form và validation nhất quán, điều hướng nhanh, hỗ trợ accessibility, responsive, hạn chế animation. Skill/MCP (frontend-design, Playwright MCP, CodeGraph) chỉ là công cụ hỗ trợ phát triển, không bao giờ là runtime dependency.
