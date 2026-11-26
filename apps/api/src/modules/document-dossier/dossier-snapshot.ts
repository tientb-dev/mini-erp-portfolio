import { EntityManager } from 'typeorm';
import { DocumentTarget } from '../document-records/document-records';

/** Called by the owning document module after it creates the document, using the same transaction. */
export async function snapshotDocumentDossier(m: EntityManager, type: DocumentTarget, id: number, actorId: number) {
  if (!m.queryRunner?.isTransactionActive) throw new Error('A dossier snapshot requires the document transaction');
  const rows: { document_id: number }[] = await m.query(`
    WITH initialized AS (
      INSERT INTO document_dossier_snapshots (document_type, document_id, created_by)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING document_id
    ), copied AS (
      INSERT INTO document_dossiers
        (document_type, document_id, dossier_type_id, snapshot_code, snapshot_name, position, created_by, updated_by)
      SELECT $1, initialized.document_id, t.id, t.code, t.name, mapping.position, $3, $3
        FROM initialized CROSS JOIN document_dossier_type_mappings mapping
        JOIN document_dossier_types t ON t.id = mapping.dossier_type_id
       WHERE mapping.document_type = $1 AND t.is_active
    )
    SELECT document_id FROM initialized`, [type, id, actorId]);
  return rows.length > 0;
}
