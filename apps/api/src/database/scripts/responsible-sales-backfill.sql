-- Controlled manual backfill of sales_contracts.responsible_sales_user_id for legacy ACTIVE contracts.
-- Never derive the value from created_by: every row in `mapping` must be confirmed by the business owner.
-- Edit the VALUES list, then run:
--   docker compose exec -T postgres psql -U mini_erp -d mini_erp -v ON_ERROR_STOP=1 -f - < apps/api/src/database/scripts/responsible-sales-backfill.sql
-- The script aborts (whole transaction rolled back) on any mismatch. See docs/runbooks/responsible-sales-backfill.md.

BEGIN;

CREATE TEMP TABLE mapping (document_number varchar(30) PRIMARY KEY, sales_username varchar(100) NOT NULL) ON COMMIT DROP;

INSERT INTO mapping (document_number, sales_username) VALUES
  -- ('SC-2026-000001', 'sales'),
  ('__EDIT_ME__', '__EDIT_ME__');

DO $$
DECLARE bad text;
BEGIN
  IF EXISTS (SELECT 1 FROM mapping WHERE document_number = '__EDIT_ME__') THEN
    RAISE EXCEPTION 'Edit the mapping VALUES before running';
  END IF;

  -- Every contract must exist, be ACTIVE and still unassigned (never overwrite an assigned value).
  SELECT string_agg(m.document_number, ', ') INTO bad
    FROM mapping m LEFT JOIN sales_contracts s ON s.document_number = m.document_number
   WHERE s.id IS NULL OR s.status <> 'ACTIVE' OR s.responsible_sales_user_id IS NOT NULL;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Not ACTIVE-and-unassigned (or not found): %', bad; END IF;

  -- Every sales must be an active user with SALES_CONTRACT.CREATE (same rule as the API, IM24).
  SELECT string_agg(m.sales_username, ', ') INTO bad
    FROM mapping m
   WHERE NOT EXISTS (
         SELECT 1 FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id AND p.code = 'SALES_CONTRACT.CREATE'
          WHERE u.username = m.sales_username AND u.is_active);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Not eligible as responsible sales: %', bad; END IF;
END $$;

UPDATE sales_contracts s
   SET responsible_sales_user_id = u.id, version = s.version + 1, updated_at = now()
  FROM mapping m JOIN users u ON u.username = m.sales_username
 WHERE s.document_number = m.document_number AND s.status = 'ACTIVE' AND s.responsible_sales_user_id IS NULL;

SELECT s.document_number, u.username AS responsible_sales
  FROM sales_contracts s JOIN mapping m ON m.document_number = s.document_number
  JOIN users u ON u.id = s.responsible_sales_user_id ORDER BY 1;

COMMIT;
