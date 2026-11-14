import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GIR B/D source and purpose (ADR-0013 PR 7, CT13, CT16–CT19, ADR-0012).
 * - goods_issue_requests.source_sales_contract_id / source_owner_user_id: the one source HĐ + source Sales an
 *   AVAILABLE_STOCK GIR borrows from (warehouse = the GIR's). Required on live AVAILABLE_STOCK GIRs; source ≠ target.
 * - goods_issue_requests.purpose: required for D (AVAILABLE_STOCK + MATERIAL); reference for C.
 * - purchase_requisitions.purpose: optional reference on material PRs, inherited by C GIRs.
 * - D lines carry only a product (no PR line, no HĐ line), so chk_goods_issue_request_lines_source is dropped; the line
 *   source rule per GIR type is enforced by the application (it depends on the header).
 * Stops instead of guessing when live AVAILABLE_STOCK GIRs exist: their source HĐ/Sales was never recorded.
 */
export class GirAvailableStockSource1732233600000 implements MigrationInterface {
  name = 'GirAvailableStockSource1732233600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      DECLARE bad text;
      BEGIN
        SELECT string_agg(document_number, ', ' ORDER BY document_number) INTO bad
          FROM goods_issue_requests WHERE issue_type = 'AVAILABLE_STOCK' AND approval_status <> 'CANCELED';
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'AVAILABLE_STOCK GIRs without a recorded source HĐ/Sales are still live: %. Cancel them (or reset a dev database) and rerun.', bad;
        END IF;
      END $$;

      ALTER TABLE purchase_requisitions ADD COLUMN purpose text;
      ALTER TABLE goods_issue_request_lines DROP CONSTRAINT chk_goods_issue_request_lines_source;
      ALTER TABLE goods_issue_requests
        ADD COLUMN source_sales_contract_id int REFERENCES sales_contracts(id),
        ADD COLUMN source_owner_user_id int REFERENCES users(id),
        ADD COLUMN purpose text,
        ADD CONSTRAINT chk_goods_issue_requests_source CHECK (
          issue_type <> 'AVAILABLE_STOCK' OR approval_status = 'CANCELED'
          OR (source_sales_contract_id IS NOT NULL AND source_owner_user_id IS NOT NULL AND source_sales_contract_id <> sales_contract_id)),
        ADD CONSTRAINT chk_goods_issue_requests_purpose CHECK (
          NOT (issue_type = 'AVAILABLE_STOCK' AND category = 'MATERIAL') OR approval_status = 'CANCELED' OR length(btrim(purpose)) > 0);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM goods_issue_requests WHERE issue_type = 'AVAILABLE_STOCK' AND approval_status <> 'CANCELED')
           OR EXISTS (SELECT 1 FROM goods_issue_request_lines WHERE purchase_requisition_line_id IS NULL AND sales_contract_line_id IS NULL) THEN
          RAISE EXCEPTION 'Live AVAILABLE_STOCK GIRs or material lines would lose their source; reset a dev database instead.';
        END IF;
      END $$;
      ALTER TABLE goods_issue_requests DROP CONSTRAINT chk_goods_issue_requests_purpose, DROP CONSTRAINT chk_goods_issue_requests_source,
        DROP COLUMN purpose, DROP COLUMN source_owner_user_id, DROP COLUMN source_sales_contract_id;
      ALTER TABLE purchase_requisitions DROP COLUMN purpose;
      ALTER TABLE goods_issue_request_lines ADD CONSTRAINT chk_goods_issue_request_lines_source
        CHECK (purchase_requisition_line_id IS NOT NULL OR sales_contract_line_id IS NOT NULL);
    `);
  }
}
