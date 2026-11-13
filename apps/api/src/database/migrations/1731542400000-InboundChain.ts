import { MigrationInterface, QueryRunner } from 'typeorm';

// Common columns for documents with one-level approval (03 §6, ADR-0007, ADR-0011).
const DOC = `
  document_number varchar(30) NOT NULL UNIQUE,
  approval_status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK (approval_status IN ('DRAFT', 'WAITING_FOR_APPROVE', 'APPROVED', 'REJECTED', 'CANCELED')),
  created_by int NOT NULL REFERENCES users(id),
  assigned_approver_id int REFERENCES users(id),
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()`;

const QTY = 'numeric(18,3) NOT NULL CHECK (quantity > 0)';

export class InboundChain1731542400000 implements MigrationInterface {
  name = 'InboundChain1731542400000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE customers (id serial PRIMARY KEY, code varchar(50) NOT NULL UNIQUE, name varchar(300) NOT NULL);
      CREATE TABLE suppliers (id serial PRIMARY KEY, code varchar(50) NOT NULL UNIQUE, name varchar(300) NOT NULL);

      CREATE TABLE document_sequences (
        document_type varchar(10) NOT NULL,
        year int NOT NULL,
        last_value int NOT NULL,
        PRIMARY KEY (document_type, year));

      CREATE TABLE approval_histories (
        id serial PRIMARY KEY,
        document_type varchar(10) NOT NULL,
        document_id int NOT NULL,
        action varchar(20) NOT NULL,
        actor_id int NOT NULL REFERENCES users(id),
        reason text,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX idx_approval_histories_doc ON approval_histories (document_type, document_id);

      CREATE TABLE sales_contracts (
        id serial PRIMARY KEY,
        document_number varchar(30) NOT NULL UNIQUE,
        customer_id int NOT NULL REFERENCES customers(id),
        status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'CANCELED')),
        created_by int NOT NULL REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE sales_contract_lines (
        id serial PRIMARY KEY,
        sales_contract_id int NOT NULL REFERENCES sales_contracts(id),
        item_code varchar(100) NOT NULL,
        item_name varchar(300) NOT NULL,
        uom_name varchar(50) NOT NULL,
        quantity ${QTY});

      CREATE TABLE purchase_requisitions (id serial PRIMARY KEY, sales_contract_id int NOT NULL REFERENCES sales_contracts(id), ${DOC});
      CREATE TABLE purchase_requisition_lines (
        id serial PRIMARY KEY,
        purchase_requisition_id int NOT NULL REFERENCES purchase_requisitions(id),
        sales_contract_line_id int NOT NULL REFERENCES sales_contract_lines(id),
        product_id int NOT NULL REFERENCES products(id),
        snapshot_code varchar(100) NOT NULL,
        snapshot_name varchar(300) NOT NULL,
        snapshot_description text,
        unit_of_measure_id int NOT NULL REFERENCES units_of_measure(id),
        quantity ${QTY});

      CREATE TABLE purchase_orders (id serial PRIMARY KEY, supplier_id int NOT NULL REFERENCES suppliers(id), ${DOC});
      CREATE TABLE purchase_order_lines (
        id serial PRIMARY KEY,
        purchase_order_id int NOT NULL REFERENCES purchase_orders(id),
        purchase_requisition_line_id int NOT NULL REFERENCES purchase_requisition_lines(id),
        unit_of_measure_id int NOT NULL REFERENCES units_of_measure(id),
        quantity ${QTY});

      CREATE TABLE goods_receipt_requests (
        id serial PRIMARY KEY,
        purchase_order_id int NOT NULL REFERENCES purchase_orders(id),
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        ${DOC});
      CREATE TABLE goods_receipt_request_lines (
        id serial PRIMARY KEY,
        goods_receipt_request_id int NOT NULL REFERENCES goods_receipt_requests(id),
        purchase_order_line_id int NOT NULL REFERENCES purchase_order_lines(id),
        unit_of_measure_id int NOT NULL REFERENCES units_of_measure(id),
        quantity ${QTY});

      CREATE TABLE goods_receipts (
        id serial PRIMARY KEY,
        goods_receipt_request_id int NOT NULL REFERENCES goods_receipt_requests(id),
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        ${DOC});
      -- At most one non-canceled GR per GRR (03 §2).
      CREATE UNIQUE INDEX uq_goods_receipts_active_grr ON goods_receipts (goods_receipt_request_id) WHERE approval_status <> 'CANCELED';
      CREATE TABLE goods_receipt_lines (
        id serial PRIMARY KEY,
        goods_receipt_id int NOT NULL REFERENCES goods_receipts(id),
        goods_receipt_request_line_id int NOT NULL REFERENCES goods_receipt_request_lines(id),
        product_id int NOT NULL REFERENCES products(id),
        unit_of_measure_id int NOT NULL REFERENCES units_of_measure(id),
        quantity ${QTY});
      CREATE TABLE goods_receipt_details (
        id serial PRIMARY KEY,
        goods_receipt_line_id int NOT NULL REFERENCES goods_receipt_lines(id),
        quantity ${QTY},
        serial_number varchar(100),
        normalized_serial_number varchar(100),
        location varchar(200),
        warranty_info varchar(200),
        updated_by int REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now());

      CREATE TABLE inventory_serials (
        id serial PRIMARY KEY,
        product_id int NOT NULL REFERENCES products(id),
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        serial_number varchar(100) NOT NULL,
        normalized_serial_number varchar(100) NOT NULL,
        goods_receipt_detail_id int NOT NULL REFERENCES goods_receipt_details(id),
        status varchar(20) NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK', 'RESERVED', 'ISSUED')),
        CONSTRAINT uq_inventory_serials_product_sn UNIQUE (product_id, normalized_serial_number));
      CREATE TABLE inventory_serial_transactions (
        id serial PRIMARY KEY,
        inventory_serial_id int NOT NULL REFERENCES inventory_serials(id),
        movement_type varchar(10) NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
        source_document_type varchar(20) NOT NULL,
        source_line_id int NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now());
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE inventory_serial_transactions, inventory_serials, goods_receipt_details, goods_receipt_lines, goods_receipts,
        goods_receipt_request_lines, goods_receipt_requests, purchase_order_lines, purchase_orders,
        purchase_requisition_lines, purchase_requisitions, sales_contract_lines, sales_contracts,
        approval_histories, document_sequences, suppliers, customers;
    `);
  }
}
