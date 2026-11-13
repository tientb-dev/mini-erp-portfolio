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
pnpm seed                     # admin + approver (ADMIN), business roles + users sales/pm/purchaser/warehouse (SEED_ROLE_USERS_PASSWORD), PCS UoM, HCM warehouse
pnpm seed:demo                # optional shortcut; the whole HĐ → PR → PO → GRR → GR → GIR → GI chain can now be done in the UI
pnpm dev:api                  # http://localhost:3100 (OpenAPI UI: /docs)
pnpm dev:web                  # http://localhost:5180 — sign in with SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD
pnpm test                     # API: Jest (unit + integration on mini_erp_test), Web: Vitest
```

## Repository layout
```
apps/api             NestJS API (TypeORM, migrations in src/database/migrations)
apps/web             React + Vite (MUI, TanStack Query, react-i18next)
docs/                business requirements (01–05, MVP baseline)
docs/architecture/   architecture, ADRs, open questions
docker-compose.yml   PostgreSQL
```
