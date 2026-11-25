\set ON_ERROR_STOP on
\if :{?verified_local_test}
  \if :verified_local_test
  \else
    \quit 3
  \endif
\else
  \echo Confirm the local Compose test database with -v verified_local_test=1.
  \quit 3
\endif

BEGIN;
DO $$
BEGIN
  IF current_database() <> 'mini_erp_test' OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'Expected mini_erp_test inside local Compose PostgreSQL using a Unix socket';
  END IF;
END $$;

LOCK TABLE public.purchase_requisitions, public.purchase_requisition_lines IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchase_order_lines)
     OR EXISTS (SELECT 1 FROM public.goods_issue_request_lines WHERE purchase_requisition_line_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Reset refused: PO or GIR still references PR lines';
  END IF;
  IF to_regclass('public.document_notes') IS NOT NULL THEN
    DELETE FROM public.document_notes WHERE target_type = 'PR';
    ALTER TABLE public.approval_histories DISABLE TRIGGER protect_document_activity_rows;
    DELETE FROM public.approval_histories WHERE document_type = 'PR';
    ALTER TABLE public.approval_histories ENABLE TRIGGER protect_document_activity_rows;
  ELSE
    IF to_regclass('public.pr_notes') IS NOT NULL THEN
      DELETE FROM public.pr_notes;
    END IF;
    DELETE FROM public.approval_histories WHERE document_type = 'PR';
  END IF;
  IF to_regclass('public.pr_workflow_nodes') IS NOT NULL THEN
    DELETE FROM public.pr_workflow_nodes;
    DELETE FROM public.pr_notifications;
  END IF;
END $$;

DELETE FROM public.purchase_requisition_lines;
DELETE FROM public.purchase_requisitions;
COMMIT;
