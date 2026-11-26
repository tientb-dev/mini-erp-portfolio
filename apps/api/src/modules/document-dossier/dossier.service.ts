import { Injectable, NotFoundException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DOCUMENT_TARGETS, DocumentTarget } from '../document-records/document-records';
import { BusinessError } from '../workflow/workflow';

interface CatalogInput { code: string; name: string; description?: string | null }
const catalogFields = 'id, code, name, description, is_active AS "isActive"';

@Injectable()
export class DossierService {
  constructor(private readonly db: DataSource) {}

  listTypes() {
    return this.db.query(`SELECT ${catalogFields} FROM document_dossier_types ORDER BY code, id`);
  }

  async getType(id: number) {
    const [row] = await this.db.query(`SELECT ${catalogFields} FROM document_dossier_types WHERE id = $1`, [id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  async saveType(input: CatalogInput, actor: number, id?: number) {
    const code = input.code.trim().toUpperCase();
    if (code.length > 50) throw new BusinessError('INVALID_DOSSIER_CODE', 'Dossier code must fit in 50 characters');
    const values = [code, input.name.trim(), input.description?.trim() || null, actor];
    if (id === undefined) {
      const [row] = await this.db.query(`INSERT INTO document_dossier_types (code, name, description, created_by, updated_by)
        VALUES ($1,$2,$3,$4,$4) RETURNING ${catalogFields}`, values);
      return row;
    }
    const [[row]] = await this.db.query(`UPDATE document_dossier_types SET code=$1, name=$2, description=$3,
      updated_by=$4, updated_at=now() WHERE id=$5 RETURNING ${catalogFields}`, [...values, id]);
    if (!row) throw new NotFoundException();
    return row;
  }

  async status(id: number, active: boolean, actor: number) {
    const [[row]] = await this.db.query(`UPDATE document_dossier_types SET is_active=$2, updated_by=$3,
      updated_at=now() WHERE id=$1 RETURNING id`, [id, active, actor]);
    if (!row) throw new NotFoundException();
  }

  async configurations() {
    const rows: { document_type: DocumentTarget; count: number }[] = await this.db.query(
      'SELECT document_type, count(*)::int AS count FROM document_dossier_type_mappings GROUP BY document_type');
    const counts = new Map(rows.map(row => [row.document_type, row.count]));
    return DOCUMENT_TARGETS.map(documentType => ({ documentType, count: counts.get(documentType) ?? 0 }));
  }

  async configuration(type: DocumentTarget) {
    const [config] = await this.db.query(`SELECT COALESCE(c.version, 0) AS version,
      COALESCE((SELECT json_agg(json_build_object('id',t.id,'code',t.code,'name',t.name,'isActive',t.is_active)
        ORDER BY m.position) FROM document_dossier_type_mappings m JOIN document_dossier_types t ON t.id=m.dossier_type_id
        WHERE m.document_type = $1), '[]') AS items
      FROM (SELECT $1::text AS document_type) target LEFT JOIN document_dossier_configurations c USING (document_type)`, [type]);
    return config;
  }

  saveConfiguration(type: DocumentTarget, version: number, ids: number[], actor: number) {
    return this.db.transaction(async m => {
      await m.query(`INSERT INTO document_dossier_configurations (document_type) VALUES ($1) ON CONFLICT DO NOTHING`, [type]);
      const [current] = await m.query('SELECT version FROM document_dossier_configurations WHERE document_type=$1 FOR UPDATE', [type]);
      if (current.version !== version) throw new BusinessError('STALE_VERSION', 'The configuration has changed. Reload before saving.', HttpStatus.CONFLICT);
      if (new Set(ids).size !== ids.length) throw new BusinessError('DUPLICATE_DOSSIER_TYPE', 'Select each dossier type once');
      const eligible: { id: number; allowed: boolean }[] = await m.query(`
        SELECT t.id, t.is_active OR EXISTS (SELECT 1 FROM document_dossier_type_mappings x
          WHERE x.document_type=$1 AND x.dossier_type_id=t.id) AS allowed
          FROM document_dossier_types t WHERE t.id=ANY($2::int[]) ORDER BY t.id FOR UPDATE`, [type, ids]);
      if (eligible.length !== ids.length || eligible.some(row => !row.allowed)) {
        throw new BusinessError('INVALID_DOSSIER_TYPE', 'New dossier types must exist and be active');
      }
      await m.query('DELETE FROM document_dossier_type_mappings WHERE document_type=$1', [type]);
      await m.query(`INSERT INTO document_dossier_type_mappings (document_type,dossier_type_id,position)
        SELECT $1, value, ord FROM unnest($2::int[]) WITH ORDINALITY AS selected(value, ord)`, [type, ids]);
      await m.query('UPDATE document_dossier_types SET first_used_at=now() WHERE id=ANY($1::int[]) AND first_used_at IS NULL', [ids]);
      await m.query('UPDATE document_dossier_configurations SET version=version+1,updated_at=now(),updated_by=$2 WHERE document_type=$1', [type, actor]);
    });
  }
}
