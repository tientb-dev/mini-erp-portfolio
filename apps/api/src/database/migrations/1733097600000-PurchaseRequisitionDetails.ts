import { MigrationInterface, QueryRunner } from 'typeorm';

export class PurchaseRequisitionDetails1733097600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE purchase_requisitions
        ADD COLUMN name text,
        ADD COLUMN requisition_date date,
        ADD COLUMN required_date date,
        ADD COLUMN description text,
        ADD COLUMN currency_id int REFERENCES currencies(id),
        ADD COLUMN currency_code varchar(3),
        ADD COLUMN currency_decimal_places smallint CHECK (currency_decimal_places BETWEEN 0 AND 8),
        ADD COLUMN exchange_rate numeric CHECK (exchange_rate > 0 AND exchange_rate < 'Infinity' AND exchange_rate = trunc(exchange_rate, 8)),
        ADD COLUMN exchange_rate_source text CHECK (exchange_rate_source IN ('CATALOG', 'MANUAL')),
        ADD CHECK (currency_code IS DISTINCT FROM 'VND' OR (exchange_rate = 1 AND exchange_rate_source = 'CATALOG')),
        ADD CHECK (num_nonnulls(currency_id, currency_code, currency_decimal_places, exchange_rate, exchange_rate_source) IN (0, 5));
      ALTER TABLE purchase_requisition_lines
        ALTER COLUMN product_id DROP NOT NULL,
        ALTER COLUMN unit_of_measure_id DROP NOT NULL,
        ADD COLUMN temporary_product_id int REFERENCES temporary_products(id),
        ADD COLUMN requirement_description text,
        ADD COLUMN brand_id int REFERENCES brands(id),
        ADD COLUMN brand_name text,
        ADD COLUMN supplier_id int REFERENCES suppliers(id),
        ADD COLUMN supplier_name text,
        ADD COLUMN uom_code text,
        ADD COLUMN unit_price numeric CHECK (unit_price >= 0 AND unit_price < 'Infinity' AND unit_price = trunc(unit_price, 4)),
        ADD COLUMN tax_rate_id int REFERENCES tax_rates(id),
        ADD COLUMN tax_rate numeric CHECK (tax_rate BETWEEN 0 AND 100 AND tax_rate = trunc(tax_rate, 2)),
        ADD CONSTRAINT chk_pr_line_source CHECK (num_nonnulls(product_id, temporary_product_id) = 1),
        ADD CONSTRAINT chk_pr_main_line_uom CHECK (product_id IS NULL OR unit_of_measure_id IS NOT NULL);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE purchase_requisition_lines ALTER COLUMN product_id SET NOT NULL, ALTER COLUMN unit_of_measure_id SET NOT NULL;
      ALTER TABLE purchase_requisition_lines DROP CONSTRAINT chk_pr_line_source, DROP CONSTRAINT chk_pr_main_line_uom, DROP COLUMN temporary_product_id,
        DROP COLUMN requirement_description, DROP COLUMN brand_id, DROP COLUMN brand_name, DROP COLUMN supplier_id,
        DROP COLUMN supplier_name, DROP COLUMN uom_code, DROP COLUMN unit_price, DROP COLUMN tax_rate_id, DROP COLUMN tax_rate;
      ALTER TABLE purchase_requisitions DROP COLUMN name, DROP COLUMN requisition_date, DROP COLUMN required_date,
        DROP COLUMN description, DROP COLUMN currency_id, DROP COLUMN currency_code, DROP COLUMN currency_decimal_places,
        DROP COLUMN exchange_rate, DROP COLUMN exchange_rate_source;
    `);
  }
}
