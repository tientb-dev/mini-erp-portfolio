-- Read-only inventory reconciliation (ADR-0013, PR 4). Expect 0 rows; each row is one discrepancy (check_name, detail).
-- Covers every operation that changes inventory today:
--   GR approve        → balance on_hand +, IN movement, lot (on hand = received), serials IN_STOCK   (ON_HAND, LOT, GR_LINE, SERIALS)
--   GI submit         → balance + lot reserved via allocations (FIFO / serial lots), serials RESERVED (RESERVED, LOT, ALLOCATION, SERIAL_ALLOCATION, SERIALS)
--   GI reject/recall  → reserved released on the allocated lots, allocations deleted, serials IN_STOCK (RESERVED, LOT, ALLOCATION, SERIALS)
--   GI approve        → balance + allocated lots on hand/reserved −, OUT movement, serials ISSUED   (ON_HAND, RESERVED, LOT, GI_LINE, SERIALS)
--   No stock adjustment exists; any other movement source is reported                              (MOVEMENT_SOURCE)
-- Run: docker compose exec -T postgres psql -U mini_erp -d mini_erp -f - < apps/api/src/database/scripts/inventory-reconcile.sql
-- Same query as RECONCILE_SQL in migrations/1732060800000-LotAllocations.ts (the migration aborts when it returns rows).
WITH lot AS (SELECT warehouse_id, product_id, SUM(received_quantity) AS received, SUM(on_hand_quantity) AS on_hand,
                    SUM(reserved_quantity) AS reserved FROM inventory_lots GROUP BY 1, 2),
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
                    COALESCE(lot.received, 0) AS lot_in, COALESCE(lot.on_hand, 0) AS lot_on_hand, COALESCE(lot.reserved, 0) AS lot_reserved,
                    COALESCE(out_tx.q, 0) AS issued, COALESCE(pending_gi.q, 0) AS pending,
                    p.is_serial_tracked, COALESCE(sn.held, 0) AS sn_held, COALESCE(sn.reserved, 0) AS sn_reserved
               FROM k JOIN products p ON p.id = k.product_id
               LEFT JOIN inventories i ON i.warehouse_id = k.warehouse_id AND i.product_id = k.product_id
               LEFT JOIN lot ON lot.warehouse_id = k.warehouse_id AND lot.product_id = k.product_id
               LEFT JOIN out_tx ON out_tx.warehouse_id = k.warehouse_id AND out_tx.product_id = k.product_id
               LEFT JOIN pending_gi ON pending_gi.warehouse_id = k.warehouse_id AND pending_gi.product_id = k.product_id
               LEFT JOIN sn ON sn.warehouse_id = k.warehouse_id AND sn.product_id = k.product_id),
     gr_line AS (SELECT grl.id, gr.warehouse_id, grl.product_id, grl.quantity, gr.approval_status = 'APPROVED' AS approved
                   FROM goods_receipt_lines grl JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id),
     gi_line AS (SELECT gil.id, gi.warehouse_id, gil.product_id, gil.quantity, gi.approval_status AS status
                   FROM goods_issue_lines gil JOIN goods_issues gi ON gi.id = gil.goods_issue_id),
     alloc AS (SELECT a.inventory_lot_id, a.goods_issue_line_id, a.quantity, g.status, g.warehouse_id, g.product_id
                 FROM goods_issue_line_allocations a JOIN gi_line g ON g.id = a.goods_issue_line_id),
     lot_use AS (SELECT l.id, l.warehouse_id, l.product_id, l.received_quantity, l.on_hand_quantity, l.reserved_quantity,
                        COALESCE(SUM(a.quantity) FILTER (WHERE a.status = 'APPROVED'), 0) AS issued,
                        COALESCE(SUM(a.quantity) FILTER (WHERE a.status = 'WAITING_FOR_APPROVE'), 0) AS reserved_alloc
                   FROM inventory_lots l LEFT JOIN alloc a ON a.inventory_lot_id = l.id GROUP BY l.id)
-- 1. Balance on hand = Σ lots received − Σ OUT, and = Σ lot on hand
SELECT 'ON_HAND' AS check_name, warehouse_id, product_id,
       format('on_hand %s, lots received %s, issued %s, lots on hand %s', on_hand, lot_in, issued, lot_on_hand) AS detail
  FROM bal WHERE on_hand <> lot_in - issued OR on_hand <> lot_on_hand
UNION ALL
-- 2. Balance reserved = Σ GI lines WAITING_FOR_APPROVE, and = Σ lot reserved
SELECT 'RESERVED', warehouse_id, product_id, format('reserved %s, pending GI %s, lots reserved %s', reserved, pending, lot_reserved)
  FROM bal WHERE reserved <> pending OR reserved <> lot_reserved
UNION ALL
-- 3. Serial-tracked products: on hand / reserved = number of serials IN_STOCK+RESERVED / RESERVED
SELECT 'SERIALS', warehouse_id, product_id, format('on_hand %s/%s serials, reserved %s/%s serials', on_hand, sn_held, reserved, sn_reserved)
  FROM bal WHERE is_serial_tracked AND (on_hand <> sn_held OR reserved <> sn_reserved)
UNION ALL
-- 4. Each lot: on hand = received − allocated to APPROVED GIs; reserved = allocated to pending GIs
SELECT 'LOT', warehouse_id, product_id, format('lot %s: received %s, on hand %s, issued %s, reserved %s/%s', id, received_quantity, on_hand_quantity, issued, reserved_quantity, reserved_alloc)
  FROM lot_use WHERE on_hand_quantity <> received_quantity - issued OR reserved_quantity <> reserved_alloc
UNION ALL
-- 5. Every pending/approved GI line is fully allocated to lots of its warehouse + product; other GI lines have no allocation
SELECT 'ALLOCATION', g.warehouse_id, g.product_id, format('GI line %s (%s): quantity %s, allocated %s, foreign lots %s', g.id, g.status, g.quantity, COALESCE(s.q, 0), COALESCE(s.foreign_lots, 0))
  FROM gi_line g
  LEFT JOIN (SELECT a.goods_issue_line_id, SUM(a.quantity) AS q,
                    COUNT(*) FILTER (WHERE l.warehouse_id <> a.warehouse_id OR l.product_id <> a.product_id) AS foreign_lots
               FROM alloc a JOIN inventory_lots l ON l.id = a.inventory_lot_id GROUP BY 1) s ON s.goods_issue_line_id = g.id
 WHERE (g.status IN ('WAITING_FOR_APPROVE', 'APPROVED') AND (COALESCE(s.q, 0) <> g.quantity OR s.foreign_lots > 0))
    OR (g.status NOT IN ('WAITING_FOR_APPROVE', 'APPROVED') AND s.q IS NOT NULL)
UNION ALL
-- 6. Serial lines: each lot's allocation = number of the line's serials received in that lot
SELECT 'SERIAL_ALLOCATION', g.warehouse_id, g.product_id, format('GI line %s, lot %s: allocated %s, serials %s', g.id, x.lot_id, x.allocated, x.serials)
  FROM (SELECT COALESCE(a.goods_issue_line_id, s.goods_issue_line_id) AS line_id, COALESCE(a.inventory_lot_id, s.lot_id) AS lot_id,
               COALESCE(a.quantity, 0) AS allocated, COALESCE(s.n, 0) AS serials
          FROM (SELECT gs.goods_issue_line_id, lot.id AS lot_id, COUNT(*) AS n FROM goods_issue_serials gs
                  JOIN goods_receipt_details d ON d.id = gs.goods_receipt_detail_id
                  JOIN inventory_lots lot ON lot.goods_receipt_line_id = d.goods_receipt_line_id
                  JOIN gi_line gl ON gl.id = gs.goods_issue_line_id AND gl.status IN ('WAITING_FOR_APPROVE', 'APPROVED')
                 GROUP BY 1, 2) s
          FULL JOIN (SELECT a.* FROM goods_issue_line_allocations a
                       WHERE EXISTS (SELECT 1 FROM goods_issue_serials gs WHERE gs.goods_issue_line_id = a.goods_issue_line_id)) a
            ON a.goods_issue_line_id = s.goods_issue_line_id AND a.inventory_lot_id = s.lot_id) x
  JOIN gi_line g ON g.id = x.line_id
 WHERE x.allocated <> x.serials
UNION ALL
-- 7. Every approved GR line has exactly one matching IN movement and one matching lot; nothing for other GR lines
SELECT 'GR_LINE', g.warehouse_id, g.product_id, format('GR line %s: approved %s, IN %s, lot %s', g.id, g.approved, t.quantity, l.received_quantity)
  FROM gr_line g
  LEFT JOIN inventory_transactions t ON t.source_document_type = 'GR' AND t.source_line_id = g.id AND t.movement_type = 'IN'
  LEFT JOIN inventory_lots l ON l.goods_receipt_line_id = g.id
 WHERE (g.approved AND (t.id IS NULL OR t.quantity <> g.quantity OR t.warehouse_id <> g.warehouse_id OR t.product_id <> g.product_id
                        OR l.id IS NULL OR l.received_quantity <> g.quantity OR l.warehouse_id <> g.warehouse_id OR l.product_id <> g.product_id))
    OR (NOT g.approved AND (t.id IS NOT NULL OR l.id IS NOT NULL))
UNION ALL
-- 8. Every approved GI line has exactly one matching OUT movement; nothing for other GI lines
SELECT 'GI_LINE', g.warehouse_id, g.product_id, format('GI line %s: %s, OUT %s', g.id, g.status, t.quantity)
  FROM gi_line g
  LEFT JOIN inventory_transactions t ON t.source_document_type = 'GI' AND t.source_line_id = g.id AND t.movement_type = 'OUT'
 WHERE (g.status = 'APPROVED' AND (t.id IS NULL OR t.quantity <> g.quantity OR t.warehouse_id <> g.warehouse_id OR t.product_id <> g.product_id))
    OR (g.status <> 'APPROVED' AND t.id IS NOT NULL)
UNION ALL
-- 9. No movement from any other source (no stock adjustment exists) and no orphan movement
SELECT 'MOVEMENT_SOURCE', t.warehouse_id, t.product_id, format('movement %s: %s %s line %s', t.id, t.movement_type, t.source_document_type, t.source_line_id)
  FROM inventory_transactions t
 WHERE NOT ((t.source_document_type = 'GR' AND t.movement_type = 'IN' AND EXISTS (SELECT 1 FROM goods_receipt_lines x WHERE x.id = t.source_line_id))
         OR (t.source_document_type = 'GI' AND t.movement_type = 'OUT' AND EXISTS (SELECT 1 FROM goods_issue_lines x WHERE x.id = t.source_line_id)));
