# mini-erp-portfolio

Modular Monolith Mini ERP for managing sales contracts, procurement, warehouse operations, inventory, serial numbers and approval workflows. A portfolio-quality MVP.

## Scope (MVP)
- Sales contracts (HĐ) with `DRAFT`/`ACTIVE`/`CANCELED` and confirmed deliverable products per line
- Purchase Requisition (PR) → Purchase Order (PO) → Goods Receipt Request (GRR) → Goods Receipt (GR)
- Goods Issue Request (GIR: `SALES_CONTRACT` / `AVAILABLE_STOCK`) → Goods Issue (GI)
- Inventory per Warehouse + Part Number (PN), serial number (SN) tracking and history
- One-level approval (two steps for `AVAILABLE_STOCK` GIR), warehouse-scoped permissions, in-app notifications
- Protection against over-quantity, negative stock, duplicate SN and concurrent conflicts

Out of scope: accounting, payments, transfers between warehouses, bin-level stock, warranty/returns workflow, dashboards, external integrations.

Full business requirements (Vietnamese): [`docs/01`–`05`](docs/).

## Architecture
| Layer | Technology |
|---|---|
| Backend | NestJS + TypeScript |
| Frontend | React + TypeScript |
| Database | PostgreSQL |
| Style | Modular Monolith — one API, one web app, one database |

Modules: Identity & Access, Master Data, Sales Contracts, Procurement, Inbound, Outbound, Inventory, Workflow & Notifications.
Supporting stack: TypeORM, MUI + MUI X Data Grid, TanStack Query, React Hook Form + Zod, OpenAPI + Orval, react-i18next (vi/en).
Details: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md), decisions in [docs/architecture/decisions/](docs/architecture/decisions/).

## Status
Business docs are the **MVP baseline**. Implemented: login + RBAC (`FUNCTION.ACTION`, warehouse scope, assigned approver), Products, Warehouses, Inventory balances, the inbound chain HĐ → PR → PO → GRR (API) → GR (API + UI), and outbound: Sales-confirmed products per HĐ line (API), GIR with HĐ-line quota and two-step `AVAILABLE_STOCK` approval, GI with SN reservation, and issue completion (API + UI). Product code/name/UoM/SN flag lock after use.

Implementation assumptions: [docs/architecture/OPEN-QUESTIONS.md](docs/architecture/OPEN-QUESTIONS.md) §3.

## Run locally
Requires Node 22+, pnpm, Docker.
```bash
cp .env.example .env          # adjust secrets/ports if needed
pnpm install
pnpm db:up                    # PostgreSQL on 127.0.0.1:5442 (+ mini_erp_test database)
pnpm migrate                  # TypeORM migrations
pnpm seed                     # bootstrap ADMIN, default business roles, PCS UoM and HCM warehouse
pnpm dev:api                  # http://localhost:3100 (OpenAPI UI: /docs)
pnpm dev:web                  # http://localhost:5180 — sign in with SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD
pnpm test                     # API: Jest (unit + integration on mini_erp_test), Web: Vitest
```

For browser fixtures, set `DATABASE_URL` to the verified local `mini_erp_test`. Run `pnpm --filter api seed --fixture-users`, configure the SALES and RECEIPT candidate pools with eligible users, then run `pnpm seed:demo`. Run browser fixtures and API regression sequentially because regression recreates the Test schema. [Clean Reset runbook](docs/runbooks/oa3-migration-deployment.md)

## Repository layout
```
apps/api             NestJS API (TypeORM, migrations in src/database/migrations)
apps/web             React + Vite (MUI, TanStack Query, react-i18next)
docs/                business requirements (01–05, MVP baseline)
docs/architecture/   architecture, ADRs, open questions
docker-compose.yml   PostgreSQL
```

### Workflow Đề nghị mua hàng (PR #18)

Xem [ADR-0015](docs/architecture/decisions/ADR-0015-purchase-requisition-workflow.md) để cấu hình tập ứng viên Sales, PM, Receipt và PM phụ trách từng hợp đồng. Đặt cấu hình tập Sales và Receipt trước khi chạy demo seed.

Database đã áp dụng workflow PR có thể chạy `pnpm migrate` và `pnpm seed` để nâng cấp Common Notes/History và đồng bộ permission. Migration bổ sung giữ dữ liệu hiện có.

Trước khi triển khai workflow lần đầu, kiểm tra bảng `purchase_requisitions` trên đúng database đích. Migration `1732406400000-PrWorkflow` yêu cầu bảng rỗng và sẽ dừng nếu phát hiện PR cũ. Với dữ liệu test có thể bỏ, dùng database test mới hoặc script bên dưới sau khi xác minh môi trường. Nếu database development hoặc production còn PR cũ, dừng triển khai và thống nhất phương án dữ liệu trước khi chạy lại. Migration giữ nguyên dữ liệu và không tự động reset database.

Khi cần xóa fixture PR, dừng tiến trình đang ghi và xác minh đích là **database test Compose cục bộ**. Lệnh nối qua Unix socket bên trong container của dự án.

```powershell
Get-Content -Raw apps/api/src/database/scripts/reset-pr-test.sql |
  docker compose exec -T postgres psql -U mini_erp -d mini_erp_test -v verified_local_test=1
```

Script chỉ xóa PR và dữ liệu workflow, thông báo, ghi chú, lịch sử của PR. Nếu PO hoặc GIR đang tham chiếu PR, script dừng và rollback toàn bộ.
