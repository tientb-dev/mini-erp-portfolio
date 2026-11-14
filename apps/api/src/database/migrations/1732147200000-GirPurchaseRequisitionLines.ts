import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GIR A/C linked to PR lines (ADR-0012, ADR-0013 PR 5; CT6 + CT10 option b).
 * - purchase_requisitions.category: SALES_GOODS (hàng bán) | MATERIAL (vật tư); never mixed in one PR (CM3).
 *   MATERIAL lines may have no HĐ line, so purchase_requisition_lines.sales_contract_line_id becomes nullable.
 * - goods_issue_requests.issue_type: PURCHASE_REQUISITION (A/C, "mua HĐ nào xuất HĐ đó") | AVAILABLE_STOCK (B/D).
 *   The legacy SALES_CONTRACT type (HĐ lines without a PR) has no flow any more and is only allowed on CANCELED rows.
 * - goods_issue_requests.category, same values; goods_issue_request_lines.purchase_requisition_line_id (one PR line,
 *   at most once per GIR); sales_contract_line_id nullable (C lines carry none).
 * Stops instead of guessing when a live legacy SALES_CONTRACT GIR exists: it cannot be mapped to a PR line.
 */
export class GirPurchaseRequisitionLines1732147200000 implements MigrationInterface {
  name = 'GirPurchaseRequisitionLines1732147200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      DECLARE bad text;
      BEGIN
        SELECT string_agg(document_number, ', ' ORDER BY document_number) INTO bad
          FROM goods_issue_requests WHERE issue_type = 'SALES_CONTRACT' AND approval_status <> 'CANCELED';
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'GIRs of the removed SALES_CONTRACT type are still live: %. They have no PR line to map to; cancel them (or reset a dev database) and rerun.', bad;
        END IF;
      END $$;

      ALTER TABLE purchase_requisitions ADD COLUMN category varchar(20) NOT NULL DEFAULT 'SALES_GOODS'
        CONSTRAINT chk_purchase_requisitions_category CHECK (category IN ('SALES_GOODS', 'MATERIAL'));
      ALTER TABLE purchase_requisition_lines ALTER COLUMN sales_contract_line_id DROP NOT NULL;

      ALTER TABLE goods_issue_requests DROP CONSTRAINT goods_issue_requests_issue_type_check;
      ALTER TABLE goods_issue_requests ADD CONSTRAINT chk_goods_issue_requests_issue_type
        CHECK (issue_type IN ('PURCHASE_REQUISITION', 'AVAILABLE_STOCK') OR (issue_type = 'SALES_CONTRACT' AND approval_status = 'CANCELED'));
      ALTER TABLE goods_issue_requests ADD COLUMN category varchar(20) NOT NULL DEFAULT 'SALES_GOODS'
        CONSTRAINT chk_goods_issue_requests_category CHECK (category IN ('SALES_GOODS', 'MATERIAL'));

      ALTER TABLE goods_issue_request_lines
        ADD COLUMN purchase_requisition_line_id int REFERENCES purchase_requisition_lines(id),
        ALTER COLUMN sales_contract_line_id DROP NOT NULL,
        ADD CONSTRAINT chk_goods_issue_request_lines_source CHECK (purchase_requisition_line_id IS NOT NULL OR sales_contract_line_id IS NOT NULL),
        ADD CONSTRAINT uq_goods_issue_request_lines_pr_line UNIQUE (goods_issue_request_id, purchase_requisition_line_id);
      CREATE INDEX idx_goods_issue_request_lines_pr_line ON goods_issue_request_lines (purchase_requisition_line_id);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM goods_issue_requests WHERE issue_type = 'PURCHASE_REQUISITION')
           OR EXISTS (SELECT 1 FROM purchase_requisitions WHERE category = 'MATERIAL') THEN
          RAISE EXCEPTION 'PR-based GIRs or material PRs exist; the previous schema cannot hold them. Reset a dev database instead.';
        END IF;
      END $$;
      DROP INDEX idx_goods_issue_request_lines_pr_line;
      ALTER TABLE goods_issue_request_lines
        DROP CONSTRAINT uq_goods_issue_request_lines_pr_line,
        DROP CONSTRAINT chk_goods_issue_request_lines_source,
        ALTER COLUMN sales_contract_line_id SET NOT NULL,
        DROP COLUMN purchase_requisition_line_id;
      ALTER TABLE goods_issue_requests DROP COLUMN category, DROP CONSTRAINT chk_goods_issue_requests_issue_type;
      ALTER TABLE goods_issue_requests ADD CONSTRAINT goods_issue_requests_issue_type_check CHECK (issue_type IN ('SALES_CONTRACT', 'AVAILABLE_STOCK'));
      ALTER TABLE purchase_requisition_lines ALTER COLUMN sales_contract_line_id SET NOT NULL;
      ALTER TABLE purchase_requisitions DROP COLUMN category;
    `);
  }
}
