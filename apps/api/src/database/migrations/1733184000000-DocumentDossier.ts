import { MigrationInterface, QueryRunner } from 'typeorm';

export class DocumentDossier1733184000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE document_dossier_types (
        id serial PRIMARY KEY, code varchar(50) NOT NULL UNIQUE, name varchar(300) NOT NULL, description text,
        is_active boolean NOT NULL DEFAULT true, first_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        created_by int NOT NULL REFERENCES users(id), updated_by int NOT NULL REFERENCES users(id),
        CHECK (code = upper(btrim(code)) AND code <> '' AND btrim(name) <> '')
      );
      CREATE TABLE document_dossier_configurations (
        document_type text PRIMARY KEY CHECK (document_type IN ('PR','PO','GRR','GIR','GR','GI','SALES_CONTRACT')),
        version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by int REFERENCES users(id)
      );
      CREATE TABLE document_dossier_type_mappings (
        document_type text NOT NULL REFERENCES document_dossier_configurations(document_type),
        dossier_type_id int NOT NULL REFERENCES document_dossier_types(id),
        position integer NOT NULL CHECK (position > 0),
        PRIMARY KEY (document_type, dossier_type_id), UNIQUE (document_type, position)
      );
      CREATE TABLE document_dossier_snapshots (
        document_type text NOT NULL CHECK (document_type IN ('PR','PO','GRR','GIR','GR','GI','SALES_CONTRACT')),
        document_id int NOT NULL CHECK (document_id > 0),
        created_at timestamptz NOT NULL DEFAULT now(), created_by int NOT NULL REFERENCES users(id),
        PRIMARY KEY (document_type, document_id)
      );
      CREATE TABLE document_dossiers (
        id serial PRIMARY KEY,
        document_type text NOT NULL, document_id int NOT NULL,
        dossier_type_id int NOT NULL REFERENCES document_dossier_types(id),
        snapshot_code varchar(50) NOT NULL, snapshot_name varchar(300) NOT NULL,
        position integer NOT NULL CHECK (position > 0),
        has_paper boolean NOT NULL DEFAULT false, issued_on date, issuer text, note text,
        inherited_from_id int REFERENCES document_dossiers(id),
        current_attachment_id int,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        created_by int NOT NULL REFERENCES users(id), updated_by int NOT NULL REFERENCES users(id),
        FOREIGN KEY (document_type, document_id) REFERENCES document_dossier_snapshots(document_type, document_id),
        UNIQUE (document_type, document_id, dossier_type_id), UNIQUE (document_type, document_id, position)
      );
      CREATE TABLE document_dossier_files (
        id serial PRIMARY KEY, storage_key text NOT NULL UNIQUE, original_name text NOT NULL,
        media_type text NOT NULL CHECK (media_type IN (
          'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/jpeg','image/png')),
        size_bytes bigint NOT NULL CHECK (size_bytes > 0),
        uploaded_by int NOT NULL REFERENCES users(id), uploaded_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz, committed_at timestamptz,
        CHECK (committed_at IS NOT NULL OR expires_at IS NOT NULL)
      );
      CREATE TABLE document_dossier_attachments (
        id serial PRIMARY KEY, dossier_id int NOT NULL REFERENCES document_dossiers(id),
        file_id int NOT NULL REFERENCES document_dossier_files(id),
        attached_by int NOT NULL REFERENCES users(id), attached_at timestamptz NOT NULL DEFAULT now(),
        ended_by int REFERENCES users(id), ended_at timestamptz,
        CHECK ((ended_at IS NULL) = (ended_by IS NULL)), UNIQUE (dossier_id, id)
      );
      CREATE UNIQUE INDEX uq_document_dossier_attachment_current ON document_dossier_attachments(dossier_id) WHERE ended_at IS NULL;
      CREATE INDEX ix_document_dossier_attachment_file ON document_dossier_attachments(file_id);
      ALTER TABLE document_dossiers ADD CONSTRAINT fk_dossier_current_attachment
        FOREIGN KEY (id, current_attachment_id) REFERENCES document_dossier_attachments(dossier_id, id);
      INSERT INTO permissions (code) VALUES ('DOSSIER_TYPE.VIEW'), ('DOSSIER_TYPE.MANAGE'),
        ('DOSSIER_CONFIG.MANAGE'), ('PR.DOSSIER_MANAGE') ON CONFLICT (code) DO NOTHING;
      INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.code = 'ADMIN' AND p.code IN ('DOSSIER_TYPE.VIEW','DOSSIER_TYPE.MANAGE','DOSSIER_CONFIG.MANAGE','PR.DOSSIER_MANAGE')
        ON CONFLICT DO NOTHING;
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE document_dossiers DROP CONSTRAINT fk_dossier_current_attachment;
      DROP TABLE document_dossier_attachments, document_dossier_files, document_dossiers, document_dossier_snapshots,
        document_dossier_type_mappings, document_dossier_configurations, document_dossier_types;
      DELETE FROM role_permissions USING permissions p
        WHERE permission_id = p.id AND p.code IN ('DOSSIER_TYPE.VIEW','DOSSIER_TYPE.MANAGE','DOSSIER_CONFIG.MANAGE','PR.DOSSIER_MANAGE');
      DELETE FROM permissions WHERE code IN ('DOSSIER_TYPE.VIEW','DOSSIER_TYPE.MANAGE','DOSSIER_CONFIG.MANAGE','PR.DOSSIER_MANAGE');
    `);
  }
}
