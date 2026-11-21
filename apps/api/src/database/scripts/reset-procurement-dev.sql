\set ON_ERROR_STOP on
\if :{?verified_local_dev}
  \if :verified_local_dev
  \else
    \echo Set verified_local_dev=1 once the local Compose database is confirmed.
    \quit 3
  \endif
\else
  \echo Run this file only inside the local Docker Compose PostgreSQL container with -v verified_local_dev=1.
  \quit 3
\endif

BEGIN;
DO $$
BEGIN
  IF current_database() NOT IN ('mini_erp', 'mini_erp_test') OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'Expected the local Compose development/test database using a Unix socket';
  END IF;
END $$;

DO $$
DECLARE
  workflow_tables text := '';
BEGIN
  IF to_regclass('public.pr_workflow_nodes') IS NOT NULL THEN
    workflow_tables := 'public.pr_workflow_nodes, public.pr_notes, public.pr_notifications, ';
  END IF;
  EXECUTE 'TRUNCATE TABLE ' || workflow_tables ||
    'public.goods_issue_line_allocations, public.goods_issue_serials, public.goods_issue_lines, public.goods_issues,
     public.goods_issue_request_lines, public.goods_issue_requests,
     public.inventory_serial_transactions, public.inventory_serials, public.inventory_transactions,
     public.inventory_lots, public.inventories, public.goods_receipt_details, public.goods_receipt_lines,
     public.goods_receipts, public.goods_receipt_request_lines, public.goods_receipt_requests,
     public.purchase_order_lines, public.purchase_orders, public.purchase_requisition_lines, public.purchase_requisitions';
END $$;
DELETE FROM approval_histories WHERE document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI');
COMMIT;
