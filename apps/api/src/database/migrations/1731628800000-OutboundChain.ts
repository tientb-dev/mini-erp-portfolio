import { MigrationInterface, QueryRunner } from 'typeorm';

const DOC = `
  document_number varchar(30) NOT NULL UNIQUE,
  approval_status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (approval_status IN ('DRAFT', 'WAITING_FOR_APPROVE', 'APPROVED', 'REJECTED', 'CANCELED')),
  created_by int NOT NULL REFERENCES users(id),
  assigned_approver_id int REFERENCES users(id),
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()`;

export class OutboundChain1731628800000 implements MigrationInterface {
  name = 'OutboundChain1731628800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      -- Usage markers written by document modules (ARCHITECTURE §2.1) so Master Data never queries document tables.
      -- is_used: code/name/translations/UoM locked (03 §1c). is_stock_used: is_serial_tracked locked (03 §1b).
      ALTER TABLE products ADD COLUMN is_used boolean NOT NULL DEFAULT false, ADD COLUMN is_stock_used boolean NOT NULL DEFAULT false;
      UPDATE products p SET is_used = true WHERE EXISTS (SELECT 1 FROM purchase_requisition_lines l WHERE l.product_id = p.id);
      UPDATE products p SET is_stock_used = true WHERE EXISTS (SELECT 1 FROM goods_receipt_lines l WHERE l.product_id = p.id)
        OR EXISTS (SELECT 1 FROM goods_receipt_request_lines gl JOIN purchase_order_lines pol ON pol.id = gl.purchase_order_line_id
                   JOIN purchase_requisition_lines prl ON prl.id = pol.purchase_requisition_line_id WHERE prl.product_id = p.id);

      -- Products allowed for delivery per HĐ line: PM proposes, Sales decides (03 §9.2, ADR-0009).
      CREATE TABLE sales_contract_line_products (
        id serial PRIMARY KEY,
        sales_contract_line_id int NOT NULL REFERENCES sales_contract_lines(id),
        product_id int NOT NULL REFERENCES products(id),
        status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        reason text NOT NULL,
        proposed_by int NOT NULL REFERENCES users(id),
        proposed_at timestamptz NOT NULL DEFAULT now(),
        decided_by int REFERENCES users(id),
        decided_at timestamptz,
        decision_note text);
      -- One open (PENDING/APPROVED) proposal per line + product; rejected ones may be re-proposed.
      CREATE UNIQUE INDEX uq_sc_line_products_open ON sales_contract_line_products (sales_contract_line_id, product_id) WHERE status <> 'REJECTED';

      CREATE TABLE goods_issue_requests (
        id serial PRIMARY KEY,
        issue_type varchar(20) NOT NULL CHECK (issue_type IN ('SALES_CONTRACT', 'AVAILABLE_STOCK')),
        sales_contract_id int NOT NULL REFERENCES sales_contracts(id),
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        -- AVAILABLE_STOCK only: 1 = Sales confirmation, 2 = warehouse manager approval (ADR-0010).
        approval_step smallint CHECK (approval_step IN (1, 2)),
        warehouse_approver_id int REFERENCES users(id),
        execution_status varchar(20) NOT NULL DEFAULT 'NOT_STARTED' CHECK (execution_status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
        completion_reason text,
        completed_by int REFERENCES users(id),
        completed_at timestamptz,
        ${DOC});
      CREATE TABLE goods_issue_request_lines (
        id serial PRIMARY KEY,
        goods_issue_request_id int NOT NULL REFERENCES goods_issue_requests(id),
        sales_contract_line_id int NOT NULL REFERENCES sales_contract_lines(id),
        product_id int NOT NULL REFERENCES products(id),
        quantity numeric(18,3) NOT NULL CHECK (quantity > 0));

      CREATE TABLE goods_issues (
        id serial PRIMARY KEY,
        goods_issue_request_id int NOT NULL REFERENCES goods_issue_requests(id),
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        ${DOC});
      CREATE TABLE goods_issue_lines (
        id serial PRIMARY KEY,
        goods_issue_id int NOT NULL REFERENCES goods_issues(id),
        goods_issue_request_line_id int NOT NULL REFERENCES goods_issue_request_lines(id),
        product_id int NOT NULL REFERENCES products(id),
        quantity numeric(18,3) NOT NULL CHECK (quantity > 0 AND quantity = trunc(quantity)),
        UNIQUE (goods_issue_id, goods_issue_request_line_id));
      -- F1 option C: reference the GR detail (never deleted); serial_number is a display-only snapshot (F1a).
      CREATE TABLE goods_issue_serials (
        id serial PRIMARY KEY,
        goods_issue_line_id int NOT NULL REFERENCES goods_issue_lines(id),
        goods_receipt_detail_id int NOT NULL REFERENCES goods_receipt_details(id),
        serial_number varchar(100) NOT NULL,
        UNIQUE (goods_issue_line_id, goods_receipt_detail_id));
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE goods_issue_serials, goods_issue_lines, goods_issues, goods_issue_request_lines, goods_issue_requests, sales_contract_line_products;
      ALTER TABLE products DROP COLUMN is_used, DROP COLUMN is_stock_used;`);
  }
}
