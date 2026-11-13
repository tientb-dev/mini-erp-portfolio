-- Read-only check: sales contracts that violate (or would violate) chk_sales_contracts_responsible_sales.
-- Run: docker compose exec -T postgres psql -U mini_erp -d mini_erp -f - < apps/api/src/database/scripts/responsible-sales-check.sql
-- See docs/runbooks/responsible-sales-backfill.md.

\echo '1) ACTIVE contracts without a responsible sales (must be 0 before VALIDATE CONSTRAINT):'
SELECT s.id, s.document_number, c.name AS customer, u.username AS created_by, s.created_at,
       (SELECT COUNT(*) FROM purchase_requisitions pr WHERE pr.sales_contract_id = s.id AND pr.approval_status <> 'CANCELED') AS open_prs
  FROM sales_contracts s
  JOIN customers c ON c.id = s.customer_id
  JOIN users u ON u.id = s.created_by
 WHERE s.status = 'ACTIVE' AND s.responsible_sales_user_id IS NULL
 ORDER BY s.id;

\echo '2) Contracts whose responsible sales is no longer eligible (inactive or without SALES_CONTRACT.CREATE) — informational:'
SELECT s.id, s.document_number, s.status, ru.username AS responsible_sales, ru.is_active
  FROM sales_contracts s
  JOIN users ru ON ru.id = s.responsible_sales_user_id
 WHERE s.status <> 'CANCELED'
   AND NOT (ru.is_active AND EXISTS (
         SELECT 1 FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id AND p.code = 'SALES_CONTRACT.CREATE'
          WHERE ur.user_id = ru.id))
 ORDER BY s.id;

\echo '3) Constraint state (convalidated = false until VALIDATE CONSTRAINT runs):'
SELECT conname, convalidated FROM pg_constraint WHERE conname = 'chk_sales_contracts_responsible_sales';
