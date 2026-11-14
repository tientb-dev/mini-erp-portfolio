import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inventory lots per approved GR line (ADR-0013 §3, PR 3): warehouse, product, source HĐ, responsible sales captured at
 * approval (immutable), approval time (FIFO key) and received quantity. Lot on-hand/reserved come with GI allocation (PR 4);
 * until then the balance check is: inventories.on_hand = Σ lots.received − Σ OUT movements per warehouse + product (RECONCILE_SQL).
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
        SELECT string_agg(format('%s (warehouse %s, product %s: %s)', check_name, warehouse_id, product_id, detail), '; ') INTO bad FROM (${RECONCILE_SQL}) r;
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
 * Full inventory reconciliation (ADR-0013, PR 3): returns one row per discrepancy, empty when consistent.
 * Covers every operation that changes inventory today — GR approve (IN + lot), GI submit (reserve), GI reject/recall
 * (release), GI approve (OUT) — at balance, document-line and serial level; any other movement source is flagged.
 * Same query as the PR 3 version of apps/api/src/database/scripts/inventory-reconcile.sql. Frozen with this migration on purpose.
 */
export const RECONCILE_SQL = `
WITH lot AS (SELECT warehouse_id, product_id, SUM(received_quantity) AS q FROM inventory_lots GROUP BY 1, 2),
     out_tx AS (SELECT warehouse_id, product_id, SUM(quantity) AS q FROM inventory_transactions WHERE movement_type = 'OUT' GROUP BY 1, 2),
     pending_gi AS (SELECT gi.warehouse_id, gil.product_id, SUM(gil.quantity) AS q
                      FROM goods_issue_lines gil JOIN goods_issues gi ON gi.id = gil.goods_issue_id AND gi.approval_status = 'WAITING_FOR_APPROVE'
                     GROUP BY 1, 2),
     sn AS (SELECT warehouse_id, product_id, COUNT(*) FILTER (WHERE status IN ('IN_STOCK', 'RESERVED')) AS held,
                   COUNT(*) FILTER (WHERE status = 'RESERVED') AS reserved
              FROM inventory_serials GROUP BY 1, 2),
     k AS (SELECT warehouse_id, product_id FROM inventories UNION SELECT warehouse_id, product_id FROM lot
           UNION SELECT warehouse_id, product_id FROM out_tx UNION SELECT warehouse_id, product_id FROM pending_gi
           UNION SELECT warehouse_id, product_id FROM sn),
     bal AS (SELECT k.warehouse_id, k.product_id, COALESCE(i.on_hand_quantity, 0) AS on_hand, COALESCE(i.reserved_quantity, 0) AS reserved,
                    COALESCE(lot.q, 0) AS lot_in, COALESCE(out_tx.q, 0) AS issued, COALESCE(pending_gi.q, 0) AS pending,
                    p.is_serial_tracked, COALESCE(sn.held, 0) AS sn_held, COALESCE(sn.reserved, 0) AS sn_reserved
               FROM k JOIN products p ON p.id = k.product_id
               LEFT JOIN inventories i ON i.warehouse_id = k.warehouse_id AND i.product_id = k.product_id
               LEFT JOIN lot ON lot.warehouse_id = k.warehouse_id AND lot.product_id = k.product_id
               LEFT JOIN out_tx ON out_tx.warehouse_id = k.warehouse_id AND out_tx.product_id = k.product_id
               LEFT JOIN pending_gi ON pending_gi.warehouse_id = k.warehouse_id AND pending_gi.product_id = k.product_id
               LEFT JOIN sn ON sn.warehouse_id = k.warehouse_id AND sn.product_id = k.product_id),
     gr_line AS (SELECT grl.id, gr.warehouse_id, grl.product_id, grl.quantity, gr.approval_status = 'APPROVED' AS approved
                   FROM goods_receipt_lines grl JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id),
     gi_line AS (SELECT gil.id, gi.warehouse_id, gil.product_id, gil.quantity, gi.approval_status = 'APPROVED' AS approved
                   FROM goods_issue_lines gil JOIN goods_issues gi ON gi.id = gil.goods_issue_id)
-- 1. On hand = Σ lots received (GR approve) − Σ OUT (GI approve)
SELECT 'ON_HAND' AS check_name, warehouse_id, product_id, format('on_hand %s, lots %s, issued %s', on_hand, lot_in, issued) AS detail
  FROM bal WHERE on_hand <> lot_in - issued
UNION ALL
-- 2. Reserved = Σ GI lines WAITING_FOR_APPROVE (GI submit adds, reject/recall releases, approve consumes)
SELECT 'RESERVED', warehouse_id, product_id, format('reserved %s, pending GI %s', reserved, pending) FROM bal WHERE reserved <> pending
UNION ALL
-- 3. Serial-tracked products: on hand / reserved = number of serials IN_STOCK+RESERVED / RESERVED
SELECT 'SERIALS', warehouse_id, product_id, format('on_hand %s/%s serials, reserved %s/%s serials', on_hand, sn_held, reserved, sn_reserved)
  FROM bal WHERE is_serial_tracked AND (on_hand <> sn_held OR reserved <> sn_reserved)
UNION ALL
-- 4. Every approved GR line has exactly one matching IN movement and one matching lot; nothing for other GR lines
SELECT 'GR_LINE', g.warehouse_id, g.product_id, format('GR line %s: approved %s, IN %s, lot %s', g.id, g.approved, t.quantity, l.received_quantity)
  FROM gr_line g
  LEFT JOIN inventory_transactions t ON t.source_document_type = 'GR' AND t.source_line_id = g.id AND t.movement_type = 'IN'
  LEFT JOIN inventory_lots l ON l.goods_receipt_line_id = g.id
 WHERE (g.approved AND (t.id IS NULL OR t.quantity <> g.quantity OR t.warehouse_id <> g.warehouse_id OR t.product_id <> g.product_id
                        OR l.id IS NULL OR l.received_quantity <> g.quantity OR l.warehouse_id <> g.warehouse_id OR l.product_id <> g.product_id))
    OR (NOT g.approved AND (t.id IS NOT NULL OR l.id IS NOT NULL))
UNION ALL
-- 5. Every approved GI line has exactly one matching OUT movement; nothing for other GI lines
SELECT 'GI_LINE', g.warehouse_id, g.product_id, format('GI line %s: approved %s, OUT %s', g.id, g.approved, t.quantity)
  FROM gi_line g
  LEFT JOIN inventory_transactions t ON t.source_document_type = 'GI' AND t.source_line_id = g.id AND t.movement_type = 'OUT'
 WHERE (g.approved AND (t.id IS NULL OR t.quantity <> g.quantity OR t.warehouse_id <> g.warehouse_id OR t.product_id <> g.product_id))
    OR (NOT g.approved AND t.id IS NOT NULL)
UNION ALL
-- 6. No movement from any other source (no adjustment feature exists) and no orphan movement
SELECT 'MOVEMENT_SOURCE', t.warehouse_id, t.product_id, format('movement %s: %s %s line %s', t.id, t.movement_type, t.source_document_type, t.source_line_id)
  FROM inventory_transactions t
 WHERE NOT ((t.source_document_type = 'GR' AND t.movement_type = 'IN' AND EXISTS (SELECT 1 FROM goods_receipt_lines x WHERE x.id = t.source_line_id))
         OR (t.source_document_type = 'GI' AND t.movement_type = 'OUT' AND EXISTS (SELECT 1 FROM goods_issue_lines x WHERE x.id = t.source_line_id)))`;
