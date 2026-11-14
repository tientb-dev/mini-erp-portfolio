import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PO receipt progress (03 §1, CT12, ADR-0003) and GR approval time for FIFO (ADR-0013).
 * - purchase_order_lines.received_quantity: Σ GR APPROVED quantity, maintained by Inbound via ProcurementFacade.
 * - goods_receipts.approved_at: time of the approval still in effect (NULL unless APPROVED).
 * Backfill reads current data: GR APPROVED lines, and the latest APPROVE entry in approval_histories.
 */
export class PoReceiptProgress1731888000000 implements MigrationInterface {
  name = 'PoReceiptProgress1731888000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE purchase_order_lines ADD COLUMN received_quantity numeric(18,3) NOT NULL DEFAULT 0;
      UPDATE purchase_order_lines pol SET received_quantity = r.qty
        FROM (SELECT grrl.purchase_order_line_id AS id, SUM(grl.quantity) AS qty
                FROM goods_receipt_lines grl
                JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.approval_status = 'APPROVED'
                JOIN goods_receipt_request_lines grrl ON grrl.id = grl.goods_receipt_request_line_id
               GROUP BY grrl.purchase_order_line_id) r
       WHERE r.id = pol.id;
      ALTER TABLE purchase_order_lines ADD CONSTRAINT chk_purchase_order_lines_received
        CHECK (received_quantity >= 0 AND received_quantity <= quantity);

      ALTER TABLE goods_receipts ADD COLUMN approved_at timestamptz;
      UPDATE goods_receipts gr SET approved_at = (
        SELECT MAX(h.created_at) FROM approval_histories h WHERE h.document_type = 'GR' AND h.document_id = gr.id AND h.action = 'APPROVE')
       WHERE gr.approval_status = 'APPROVED';
      ALTER TABLE goods_receipts ADD CONSTRAINT chk_goods_receipts_approved_at
        CHECK (approved_at IS NULL OR approval_status = 'APPROVED'); -- one-way: status and time are set by two statements in approveGr
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE goods_receipts DROP CONSTRAINT chk_goods_receipts_approved_at, DROP COLUMN approved_at;
      ALTER TABLE purchase_order_lines DROP CONSTRAINT chk_purchase_order_lines_received, DROP COLUMN received_quantity;
    `);
  }
}
