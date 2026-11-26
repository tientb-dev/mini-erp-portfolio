import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { appendActivity, DocumentTarget } from '../document-records/document-records';
import { DossierFile, DossierStorage, IncomingDossierFile } from './dossier-storage';
import { DossierRowUpdate } from './dossier-update.dto';

type Paper = { hasPaper: boolean; issuedOn: string | null; issuer: string | null; note: string | null };
export type DossierRow = Paper & {
  dossierTypeId: number; code: string; name: string; position: number; version: number; file: DossierFile | null;
};

@Injectable()
export class DossierDocuments {
  constructor(private readonly storage: DossierStorage) {}

  stage(actor: number, context: string, typeId: number, file: IncomingDossierFile) {
    return this.storage.stage(actor, context, typeId, file);
  }

  list(m: EntityManager, type: DocumentTarget, id: number): Promise<DossierRow[]> {
    return m.query(`SELECT d.dossier_type_id AS "dossierTypeId", d.snapshot_code AS code, d.snapshot_name AS name,
      d.position, d.version, d.has_paper AS "hasPaper", d.issued_on::text AS "issuedOn", d.issuer, d.note,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id', f.id, 'name', f.original_name,
        'mediaType', f.media_type, 'size', f.size_bytes) END AS file
      FROM document_dossiers d LEFT JOIN document_dossier_attachments a ON a.id = d.current_attachment_id
      LEFT JOIN document_dossier_files f ON f.id = a.file_id
      WHERE d.document_type = $1 AND d.document_id = $2 ORDER BY d.position`, [type, id]);
  }

  async save(m: EntityManager, type: DocumentTarget, id: number, actor: number, context: string,
    patches: DossierRowUpdate[], creating = false) {
    if (!m.queryRunner?.isTransactionActive) throw new Error('Dossier save requires the document transaction');
    const rows = new Map((await this.list(m, type, id)).map(row => [row.dossierTypeId, row]));
    for (const patch of [...patches].sort((a, b) => a.dossierTypeId - b.dossierTypeId)) {
      const previous = rows.get(patch.dossierTypeId);
      if (!previous) throw new BadRequestException('Dossier type is not part of this document');
      if (patch.version !== (creating ? 0 : previous.version)) {
        throw new ConflictException('Dossier changed in another session. Review current data before saving again.');
      }
      const before = this.paper(previous);
      const after: Paper = { hasPaper: patch.hasPaper,
        issuedOn: patch.issuedOn === undefined ? before.issuedOn : patch.issuedOn,
        issuer: patch.issuer === undefined ? before.issuer : patch.issuer,
        note: patch.note === undefined ? before.note : patch.note };
      const fileChanged = patch.fileId !== undefined && patch.fileId !== (previous.file?.id ?? null);
      if (!fileChanged && JSON.stringify(before) === JSON.stringify(after)) continue;
      const [dossier]: { id: number }[] = await m.query(`
        SELECT id FROM document_dossiers WHERE document_type = $1 AND document_id = $2 AND dossier_type_id = $3`,
      [type, id, patch.dossierTypeId]);
      let file = previous.file;
      if (fileChanged) {
        file = patch.fileId ? await this.storage.claim(m, patch.fileId, actor, context, patch.dossierTypeId) : null;
        await m.query(`UPDATE document_dossier_attachments SET ended_at = now(), ended_by = $2
          WHERE dossier_id = $1 AND ended_at IS NULL`, [dossier.id, actor]);
        const [link] = file ? await m.query(`INSERT INTO document_dossier_attachments (dossier_id, file_id, attached_by)
          VALUES ($1, $2, $3) RETURNING id`, [dossier.id, file.id, actor]) : [];
        await m.query('UPDATE document_dossiers SET current_attachment_id = $2 WHERE id = $1', [dossier.id, link?.id ?? null]);
      }
      await m.query(`UPDATE document_dossiers SET has_paper = $2, issued_on = $3, issuer = $4, note = $5,
        updated_at = now(), updated_by = $6, version = version + 1 WHERE id = $1`,
      [dossier.id, after.hasPaper, after.issuedOn, after.issuer, after.note, actor]);
      await appendActivity(m, type, id, 'DOSSIER_UPDATE', actor, undefined, {
        metadata: {
          dossierTypeId: previous.dossierTypeId, code: previous.code, name: previous.name,
          before: { ...before, file: previous.file }, after: { ...after, file },
          fileAction: fileChanged ? (file ? (previous.file ? 'REPLACE' : 'UPLOAD') : 'REMOVE') : null,
        },
      });
    }
  }

  private paper(row: Omit<DossierRowUpdate, 'fileId' | 'version' | 'dossierTypeId'>): Paper {
    return { hasPaper: row.hasPaper, issuedOn: row.issuedOn ?? null, issuer: row.issuer ?? null, note: row.note ?? null };
  }

  async download(m: EntityManager, type: DocumentTarget, documentId: number | null, fileId: number,
    temporary?: { actor: number; context: string }) {
    const [file]: (DossierFile & { key: string })[] = await m.query(`
      SELECT f.id, f.original_name AS name, f.media_type AS "mediaType", f.size_bytes::int AS size, f.storage_key AS key
      FROM document_dossier_files f WHERE f.id = $1 AND (
        (f.committed_at IS NULL AND f.expires_at > now() AND f.uploaded_by = $4 AND f.staging_context = $5)
        OR ($2::int IS NOT NULL AND EXISTS (SELECT 1 FROM document_dossier_attachments a
          JOIN document_dossiers d ON d.id = a.dossier_id WHERE a.file_id = f.id AND d.document_type = $3 AND d.document_id = $2))
      ) FOR SHARE OF f`, [fileId, documentId, type, temporary?.actor ?? null, temporary?.context ?? null]);
    if (!file) throw new NotFoundException('Dossier file not found');
    return { name: file.name, mediaType: file.mediaType, size: file.size, stream: await this.storage.open(file.key) };
  }
}
