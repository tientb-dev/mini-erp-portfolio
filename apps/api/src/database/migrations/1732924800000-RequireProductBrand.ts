import { MigrationInterface, QueryRunner } from 'typeorm';

export class RequireProductBrand1732924800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      LOCK TABLE products IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM products WHERE brand_id IS NULL) THEN
          RAISE EXCEPTION 'Assign verified brands to existing products before enforcing products.brand_id';
        END IF;
      END $$;
      ALTER TABLE products ALTER COLUMN brand_id SET NOT NULL;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE products ALTER COLUMN brand_id DROP NOT NULL');
  }
}
