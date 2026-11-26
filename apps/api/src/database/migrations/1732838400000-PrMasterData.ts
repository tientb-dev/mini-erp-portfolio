import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrMasterData1732838400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE brands (id serial PRIMARY KEY, code varchar(50) NOT NULL UNIQUE, name varchar(300) NOT NULL);
      CREATE TABLE brand_suppliers (
        brand_id int NOT NULL REFERENCES brands(id),
        supplier_id int NOT NULL REFERENCES suppliers(id),
        PRIMARY KEY (brand_id, supplier_id)
      );
      CREATE TABLE temporary_products (
        id serial PRIMARY KEY, code varchar(100) NOT NULL UNIQUE, name varchar(300) NOT NULL, description text
      );
      CREATE TABLE currencies (
        id serial PRIMARY KEY, code varchar(3) NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{3}$'),
        name varchar(300) NOT NULL, exchange_rate numeric(20,8) NOT NULL CHECK (exchange_rate > 0 AND exchange_rate < 'Infinity'),
        decimal_places smallint NOT NULL CHECK (decimal_places BETWEEN 0 AND 8),
        CHECK (code <> 'VND' OR exchange_rate = 1)
      );
      INSERT INTO currencies (code, name, exchange_rate, decimal_places) VALUES ('VND', 'Việt Nam đồng', 1, 0);
      CREATE TABLE tax_rates (
        id serial PRIMARY KEY, code varchar(50) NOT NULL UNIQUE, name varchar(300) NOT NULL,
        rate numeric(7,4) NOT NULL CHECK (rate BETWEEN 0 AND 100)
      );
      ALTER TABLE products ADD COLUMN brand_id int REFERENCES brands(id);
      ALTER TABLE sales_contract_lines
        ADD COLUMN product_id int REFERENCES products(id),
        ADD COLUMN temporary_product_id int REFERENCES temporary_products(id),
        ADD COLUMN item_description text,
        ADD CONSTRAINT chk_sc_line_catalog_source CHECK (num_nonnulls(product_id, temporary_product_id) <= 1);
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE sales_contract_lines DROP COLUMN product_id, DROP COLUMN temporary_product_id, DROP COLUMN item_description;
      ALTER TABLE products DROP COLUMN brand_id;
      DROP TABLE tax_rates, currencies, temporary_products, brand_suppliers, brands;
    `);
  }
}
