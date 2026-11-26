import { EntityManager } from 'typeorm';
import { DocumentTarget } from '../document-records/document-records';
import { createHash } from 'node:crypto';

type SnapshotType = { dossierTypeId: number; code: string; name: string; position: number };

export async function dossierTemplate(m: EntityManager, type: DocumentTarget) {
  const [result]: { version: number; rows: SnapshotType[] }[] = await m.query(`
    SELECT COALESCE((SELECT version FROM document_dossier_configurations WHERE document_type = $1), 0) AS version,
      COALESCE(jsonb_agg(jsonb_build_object('dossierTypeId', t.id, 'code', t.code, 'name', t.name, 'position', mapping.position)
        ORDER BY mapping.position), '[]'::jsonb) AS rows
    FROM document_dossier_type_mappings mapping JOIN document_dossier_types t ON t.id = mapping.dossier_type_id
    WHERE mapping.document_type = $1 AND t.is_active`, [type]);
  const revision = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  return { revision, rows: result.rows };
}

/** Called by the owning document module after it creates the document, using the same transaction. */
export async function snapshotDocumentDossier(m: EntityManager, type: DocumentTarget, id: number, actorId: number,
  validatedRows?: SnapshotType[]) {
  if (!m.queryRunner?.isTransactionActive) throw new Error('A dossier snapshot requires the document transaction');
  const types = validatedRows ?? (await dossierTemplate(m, type)).rows;
  const rows: { document_id: number }[] = await m.query(`
    WITH initialized AS (
      INSERT INTO document_dossier_snapshots (document_type, document_id, created_by)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING document_id
    ), copied AS (
      INSERT INTO document_dossiers
        (document_type, document_id, dossier_type_id, snapshot_code, snapshot_name, position, created_by, updated_by)
      SELECT $1, initialized.document_id, t."dossierTypeId", t.code, t.name, t.position, $3, $3
        FROM initialized CROSS JOIN jsonb_to_recordset($4::jsonb) AS t("dossierTypeId" int, code text, name text, position int)
    )
    SELECT document_id FROM initialized`, [type, id, actorId, JSON.stringify(types)]);
  return rows.length > 0;
}
