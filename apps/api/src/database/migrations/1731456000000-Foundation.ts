import { MigrationInterface, QueryRunner } from 'typeorm';

export class Foundation1731456000000 implements MigrationInterface {
  name = 'Foundation1731456000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE permissions (id serial PRIMARY KEY, code varchar(100) NOT NULL UNIQUE);
      CREATE TABLE roles (id serial PRIMARY KEY, code varchar(50) NOT NULL UNIQUE, name varchar(200) NOT NULL);
      CREATE TABLE role_permissions (
        role_id int NOT NULL REFERENCES roles(id),
        permission_id int NOT NULL REFERENCES permissions(id),
        PRIMARY KEY (role_id, permission_id));
      CREATE TABLE users (
        id serial PRIMARY KEY,
        username varchar(100) NOT NULL UNIQUE,
        password_hash varchar(255) NOT NULL,
        full_name varchar(200) NOT NULL,
        is_active boolean NOT NULL DEFAULT true);
      CREATE TABLE user_roles (
        user_id int NOT NULL REFERENCES users(id),
        role_id int NOT NULL REFERENCES roles(id),
        PRIMARY KEY (user_id, role_id));

      CREATE TABLE units_of_measure (id serial PRIMARY KEY, code varchar(20) NOT NULL UNIQUE, name varchar(100) NOT NULL);
      CREATE TABLE warehouses (
        id serial PRIMARY KEY,
        code varchar(50) NOT NULL UNIQUE,
        name varchar(200) NOT NULL,
        allow_available_stock_issue boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true);
      CREATE TABLE user_warehouses (
        user_id int NOT NULL REFERENCES users(id),
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        PRIMARY KEY (user_id, warehouse_id));
      CREATE TABLE products (
        id serial PRIMARY KEY,
        part_number varchar(100) NOT NULL UNIQUE,
        name varchar(300) NOT NULL,
        description text,
        unit_of_measure_id int NOT NULL REFERENCES units_of_measure(id),
        is_serial_tracked boolean NOT NULL DEFAULT true,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now());

      CREATE TABLE inventories (
        id serial PRIMARY KEY,
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        product_id int NOT NULL REFERENCES products(id),
        on_hand_quantity numeric(18,3) NOT NULL DEFAULT 0,
        reserved_quantity numeric(18,3) NOT NULL DEFAULT 0,
        UNIQUE (warehouse_id, product_id),
        CONSTRAINT chk_inventories_on_hand CHECK (on_hand_quantity >= 0),
        CONSTRAINT chk_inventories_reserved CHECK (reserved_quantity >= 0 AND reserved_quantity <= on_hand_quantity));
      CREATE TABLE inventory_transactions (
        id serial PRIMARY KEY,
        warehouse_id int NOT NULL REFERENCES warehouses(id),
        product_id int NOT NULL REFERENCES products(id),
        movement_type varchar(10) NOT NULL CHECK (movement_type IN ('IN', 'OUT')),
        quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
        source_document_type varchar(20) NOT NULL,
        source_line_id int NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (source_document_type, source_line_id, movement_type));
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DROP TABLE inventory_transactions; DROP TABLE inventories; DROP TABLE products;
      DROP TABLE user_warehouses; DROP TABLE warehouses; DROP TABLE units_of_measure;
      DROP TABLE user_roles; DROP TABLE users; DROP TABLE role_permissions; DROP TABLE roles; DROP TABLE permissions;
    `);
  }
}
