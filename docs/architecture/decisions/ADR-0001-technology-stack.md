# ADR-0001: Technology stack

- **Trạng thái:** Đã chấp nhận — 2026-11-12
- **Thay thế:** đề xuất Drizzle / Ant Design trong bản ARCHITECTURE ban đầu

## Bối cảnh
Stack lõi (NestJS, React, PostgreSQL, Modular Monolith) cố định từ đầu. Cần chốt thư viện bổ trợ.

## Quyết định
- ORM: **TypeORM**, migration commit trong repo, `synchronize: false` (chỉ cho phép trong test với DB tạm).
- UI: **MUI**; bảng dữ liệu: **MUI X Data Grid Community**.
- Vite, React Router, TanStack Query, React Hook Form + Zod, OpenAPI + Orval, `react-i18next`.
- Jest (backend), Vitest + Testing Library (frontend), Playwright (E2E).
- pnpm workspaces (không Nx/Turborepo), ESLint + Prettier, Docker Compose, GitHub Actions.
- Không dùng Drizzle, Ant Design.

## Hệ quả
- TypeORM không tự bảo đảm concurrency: bắt buộc tuân thủ ARCHITECTURE §1.1 (transaction tường minh, `pessimistic_write`, `@VersionColumn`, constraint DB).
- Data Grid Community không có grouping/aggregation/export Excel nâng cao (bản Pro/Premium); đủ cho MVP.
- Hai test runner (Jest/Vitest) — chấp nhận để mỗi app dùng mặc định của hệ sinh thái.
