import { MigrationInterface, QueryRunner } from 'typeorm';

export class CommonDocumentRecords1732492800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE document_notes (
        id serial PRIMARY KEY,
        target_type text NOT NULL CHECK (target_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT')),
        target_id int NOT NULL CHECK (target_id > 0),
        author_id int NOT NULL REFERENCES users(id),
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO document_notes (id, target_type, target_id, author_id, body, created_at)
        SELECT id, 'PR', pr_id, author_id, body, created_at FROM pr_notes;
      SELECT setval(pg_get_serial_sequence('document_notes', 'id'),
        COALESCE(MAX(id), 1), COUNT(*) > 0) FROM document_notes;
      DROP TABLE pr_notes;
      CREATE INDEX idx_document_notes_target_page ON document_notes (target_type, target_id, id DESC);
      ALTER TABLE approval_histories ADD COLUMN metadata jsonb;
      ALTER TABLE approval_histories ALTER COLUMN document_type TYPE varchar(30);
      ALTER TABLE approval_histories ADD CONSTRAINT chk_activity_target CHECK
        (document_type IN ('PR', 'PO', 'GRR', 'GR', 'GIR', 'GI', 'SALES_CONTRACT') AND document_id > 0);
      DROP INDEX idx_approval_histories_doc;
      CREATE INDEX idx_approval_histories_doc_page ON approval_histories (document_type, document_id, id DESC);
      CREATE FUNCTION protect_document_activity() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Document activity history is append-only';
      END $$;
      CREATE TRIGGER protect_document_activity_rows BEFORE UPDATE OR DELETE ON approval_histories
        FOR EACH ROW EXECUTE FUNCTION protect_document_activity();
      CREATE TRIGGER protect_document_activity_truncate BEFORE TRUNCATE ON approval_histories
        FOR EACH STATEMENT EXECUTE FUNCTION protect_document_activity();
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE pr_notes (
        id serial PRIMARY KEY,
        pr_id int NOT NULL REFERENCES purchase_requisitions(id),
        author_id int NOT NULL REFERENCES users(id),
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM document_notes WHERE target_type <> 'PR')
          OR EXISTS (SELECT 1 FROM approval_histories WHERE length(document_type) > 10 OR metadata IS NOT NULL) THEN
          RAISE EXCEPTION 'Rollback would discard document records';
        END IF;
      END $$;
      INSERT INTO pr_notes (id, pr_id, author_id, body, created_at)
        SELECT id, target_id, author_id, body, created_at FROM document_notes;
      SELECT setval(pg_get_serial_sequence('pr_notes', 'id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM pr_notes;
      DROP TABLE document_notes;
      DROP TRIGGER protect_document_activity_rows ON approval_histories;
      DROP TRIGGER protect_document_activity_truncate ON approval_histories;
      DROP FUNCTION protect_document_activity();
      DROP INDEX idx_approval_histories_doc_page;
      CREATE INDEX idx_approval_histories_doc ON approval_histories (document_type, document_id);
      ALTER TABLE approval_histories DROP CONSTRAINT chk_activity_target, DROP COLUMN metadata,
        ALTER COLUMN document_type TYPE varchar(10);
    `);
  }
}
