# ADR-0002: Ranh giới Modular Monolith

- **Trạng thái:** Đã chấp nhận — 2026-11-12

## Quyết định
- Một backend NestJS, một PostgreSQL. Tám module: Identity & Access, Master Data, Sales Contracts, Procurement, Inbound, Outbound, Inventory, Workflow & Notifications.
- Mỗi module export một facade service; không export repository/service nội bộ.
- Đồ thị phụ thuộc không vòng lặp (ARCHITECTURE §2.1). Inventory không phụ thuộc Inbound/Outbound; Procurement không phụ thuộc Inbound.
- Giao tiếp đồng bộ trong tiến trình. Không event bus/outbox/message broker trong MVP.
- Thao tác ghi cần nhất quán: một use case = một transaction, `EntityManager` được truyền qua facade. Thao tác đọc thông thường không bắt buộc transaction.

## Hệ quả
- Đơn giản, dễ debug; module có thể ghi nhiều bảng của module khác chỉ thông qua facade trong cùng transaction.
- Cần ESLint rule kiểm soát import giữa module khi scaffold.
