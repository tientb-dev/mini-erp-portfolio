import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrDossierStaging1733270400000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE document_dossier_files ADD COLUMN staging_context text,
        ADD COLUMN staging_type_id int REFERENCES document_dossier_types(id);
      ALTER TABLE document_dossier_files ADD CONSTRAINT dossier_staging_pair
        CHECK ((staging_context IS NULL) = (staging_type_id IS NULL));
      CREATE INDEX ix_dossier_files_expiry ON document_dossier_files(expires_at) WHERE committed_at IS NULL;
    `);
  }

  async down(q: QueryRunner) {
    await q.query(`
      DROP INDEX ix_dossier_files_expiry;
      ALTER TABLE document_dossier_files DROP CONSTRAINT dossier_staging_pair,
        DROP COLUMN staging_type_id, DROP COLUMN staging_context;
    `);
  }
}
