import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inventory lots per approved GR line (ADR-0013 §3, PR 3): warehouse, product, source HĐ, responsible sales captured at
 * approval (immutable), approval time (FIFO key) and received quantity. Lot on-hand/reserved come with GI allocation (PR 4);
 * until then reconciliation is: inventories.on_hand = Σ lots.received − Σ OUT movements per warehouse + product.
 *
 * Legacy data: lots are built from APPROVED GRs. The migration stops (no guessing) when a source HĐ has no responsible
 * sales — follow docs/runbooks/responsible-sales-backfill.md first — or when the built lots do not reconcile.
 */
export class InventoryLots1731974400000 implements MigrationInterface {
  name = 'InventoryLots1731974400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      DECLARE bad text;
      BEGIN
        SELECT string_agg(document_number, ', ' ORDER BY document_number) INTO bad
          FROM sales_contracts WHERE status = 'ACTIVE' AND responsible_sales_user_id IS NULL;
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'ACTIVE sales contracts without responsible sales: %. Follow docs/runbooks/responsible-sales-backfill.md, then rerun.', bad;
        END IF;
        SELECT string_agg(DISTINCT sc.document_number, ', ') INTO bad
          FROM goods_receipt_lines grl
          JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.approval_status = 'APPROVED'
          JOIN goods_receipt_request_lines grrl ON grrl.id = grl.goods_receipt_request_line_id
          JOIN purchase_order_lines pol ON pol.id = grrl.purchase_order_line_id
          JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
          JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
          JOIN sales_contracts sc ON sc.id = pr.sales_contract_id
         WHERE sc.responsible_sales_user_id IS NULL;
        IF bad IS NOT NULL THEN
          RAISE EXCEPTION 'Approved receipts come from sales contracts without responsible sales: %. Assign them (runbook), then rerun.', bad;
        END IF;
      END $$;
    `);
    // Every ACTIVE contract has a responsible sales now (checked above), so the PR 1 constraint can be validated.
    await q.query(`ALTER TABLE sales_contracts VALIDATE CONSTRAINT chk_sales_contracts_responsible_sales`);

    await q.query(`
      CREATE TABLE inventory_lots (
        id serial PRIMARY KEY,
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        product_id int NOT NULL REFERENCES products(id),
        goods_receipt_line_id int NOT NULL UNIQUE REFERENCES goods_receipt_lines(id),
        source_sales_contract_id int NOT NULL REFERENCES sales_contracts(id),
        owner_user_id int NOT NULL REFERENCES users(id),
        approved_at timestamptz NOT NULL,
        received_quantity numeric(18,3) NOT NULL CHECK (received_quantity > 0),
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX idx_inventory_lots_contract_fifo ON inventory_lots (warehouse_id, product_id, source_sales_contract_id, approved_at, id);
      CREATE INDEX idx_inventory_lots_owner_fifo ON inventory_lots (warehouse_id, product_id, owner_user_id, approved_at, id);

      INSERT INTO inventory_lots (warehouse_id, product_id, goods_receipt_line_id, source_sales_contract_id, owner_user_id, approved_at, received_quantity)
      SELECT gr.warehouse_id, grl.product_id, grl.id, sc.id, sc.responsible_sales_user_id, gr.approved_at, grl.quantity
        FROM goods_receipt_lines grl
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id AND gr.approval_status = 'APPROVED'
        JOIN goods_receipt_request_lines grrl ON grrl.id = grl.goods_receipt_request_line_id
        JOIN purchase_order_lines pol ON pol.id = grrl.purchase_order_line_id
        JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id
        JOIN purchase_requisitions pr ON pr.id = prl.purchase_requisition_id
        JOIN sales_contracts sc ON sc.id = pr.sales_contract_id
       ORDER BY grl.id;
    `);

    // Stop rather than ship lots that disagree with the balances.
    await q.query(`
      DO $$
      DECLARE bad text;
      BEGIN
        SELECT string_agg(format('warehouse %s product %s', warehouse_id, product_id), '; ') INTO bad FROM (${RECONCILE_SQL}) r;
        IF bad IS NOT NULL THEN RAISE EXCEPTION 'Inventory lots do not reconcile with inventories: %', bad; END IF;
      END $$;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    // The validated PR 1 constraint stays validated: still true for the data, and NOT VALID only existed for legacy rows.
    await q.query(`DROP TABLE inventory_lots`);
  }
}

/**
 * Rows where the balance does not match the lots, per warehouse + product:
 * on_hand = Σ lots.received − Σ OUT movements, and Σ lots.received = Σ IN movements from GR.
 * Same query as apps/api/src/database/scripts/inventory-lots-reconcile.sql.
 */
export const RECONCILE_SQL = `
  SELECT k.warehouse_id, k.product_id, COALESCE(i.on_hand_quantity, 0) AS on_hand,
         COALESCE(l.received, 0) AS lots_received, COALESCE(t.received, 0) AS gr_in, COALESCE(t.issued, 0) AS issued
    FROM (SELECT warehouse_id, product_id FROM inventories UNION SELECT warehouse_id, product_id FROM inventory_lots
          UNION SELECT warehouse_id, product_id FROM inventory_transactions) k
    LEFT JOIN inventories i ON i.warehouse_id = k.warehouse_id AND i.product_id = k.product_id
    LEFT JOIN (SELECT warehouse_id, product_id, SUM(received_quantity) AS received FROM inventory_lots GROUP BY 1, 2) l
           ON l.warehouse_id = k.warehouse_id AND l.product_id = k.product_id
    LEFT JOIN (SELECT warehouse_id, product_id,
                      SUM(quantity) FILTER (WHERE movement_type = 'IN' AND source_document_type = 'GR') AS received,
                      SUM(quantity) FILTER (WHERE movement_type = 'OUT') AS issued
                 FROM inventory_transactions GROUP BY 1, 2) t
           ON t.warehouse_id = k.warehouse_id AND t.product_id = k.product_id
   WHERE COALESCE(i.on_hand_quantity, 0) <> COALESCE(l.received, 0) - COALESCE(t.issued, 0)
      OR COALESCE(l.received, 0) <> COALESCE(t.received, 0)`;
