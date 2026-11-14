-- Read-only inventory reconciliation (ADR-0013, PR 3). Expect 0 rows; each row is one discrepancy (check_name, detail).
-- Covers every operation that changes inventory today:
--   GR approve  → on_hand +, IN movement, lot, serials IN_STOCK           (checks ON_HAND, GR_LINE, SERIALS)
--   GI submit   → reserved +, serials RESERVED                            (checks RESERVED, SERIALS)
--   GI reject / recall → reserved −, serials IN_STOCK                     (checks RESERVED, SERIALS)
--   GI approve  → on_hand −, reserved −, OUT movement, serials ISSUED      (checks ON_HAND, RESERVED, GI_LINE, SERIALS)
--   No stock adjustment exists; any other movement source is reported   (check MOVEMENT_SOURCE)
-- Lot-level on-hand arrives with GI allocation (PR 4); ON_HAND then becomes Σ lots.on_hand = on_hand.
-- Run: docker compose exec -T postgres psql -U mini_erp -d mini_erp -f - < apps/api/src/database/scripts/inventory-lots-reconcile.sql
-- Same query as RECONCILE_SQL in migrations/1731974400000-InventoryLots.ts (the migration aborts when it returns rows).
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
         OR (t.source_document_type = 'GI' AND t.movement_type = 'OUT' AND EXISTS (SELECT 1 FROM goods_issue_lines x WHERE x.id = t.source_line_id)));
