-- Read-only reconciliation of inventory_lots with inventories (ADR-0013, PR 3). Expect 0 rows.
-- Per warehouse + product: on_hand = Σ lots.received − Σ OUT movements, and Σ lots.received = Σ IN movements from GR.
-- Lot-level on-hand arrives with GI allocation (PR 4); then this check is replaced by Σ lots.on_hand = on_hand.
-- Run: docker compose exec -T postgres psql -U mini_erp -d mini_erp -f - < apps/api/src/database/scripts/inventory-lots-reconcile.sql
-- Same query as RECONCILE_SQL in migrations/1731974400000-InventoryLots.ts (the migration aborts when it returns rows).
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
    OR COALESCE(l.received, 0) <> COALESCE(t.received, 0);
