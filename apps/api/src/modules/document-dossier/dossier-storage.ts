import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { dossierMaxFileBytes } from './dossier-file-policy';
import { validateDossierFile } from './dossier-file-validation';

const stagingHours = 24;
const storageKey = /^[0-9a-f-]{36}$/;
export type IncomingDossierFile = { originalname: string; mimetype: string; buffer: Buffer };
export type DossierFile = { id: number; name: string; mediaType: string; size: number };

@Injectable()
export class DossierStorage implements OnModuleInit, OnModuleDestroy {
  private readonly root = resolve(process.env.DOSSIER_STORAGE_DIR ?? resolve(__dirname, '../../../../../.local/dossiers'));
  private readonly logger = new Logger(DossierStorage.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly ds: DataSource) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup().catch((error: unknown) => this.logger.error(error)), 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() { clearInterval(this.timer); }

  private path(key: string) {
    if (!storageKey.test(key)) throw new Error('Invalid dossier storage key');
    return join(this.root, key);
  }

  private async remove(key: string) {
    try { await unlink(this.path(key)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async stage(actor: number, context: string, typeId: number, file: IncomingDossierFile) {
    if (file.buffer.length > dossierMaxFileBytes()) throw new PayloadTooLargeException();
    const utf8Name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const name = (utf8Name.includes('\ufffd') ? file.originalname : utf8Name)
      .split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, '');
    const mediaType = await validateDossierFile(name, file.mimetype, file.buffer);
    const key = randomUUID();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return this.ds.transaction(async m => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      const output = await open(this.path(key), 'wx', 0o600);
      try {
        await output.writeFile(file.buffer);
        await output.sync();
      } finally { await output.close(); }
      if (process.platform !== 'win32') {
        const directory = await open(this.root, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
      const [row]: { id: number }[] = await m.query(`
        INSERT INTO document_dossier_files
          (storage_key, original_name, media_type, size_bytes, uploaded_by, expires_at, staging_context, staging_type_id)
        VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6), $7, $8) RETURNING id`,
      [key, name, mediaType, file.buffer.length, actor, stagingHours, context, typeId]);
      return { id: row.id, name, mediaType, size: file.buffer.length };
    });
  }

  async assertPresent(key: string) {
    try {
      if ((await stat(this.path(key))).isFile()) return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    throw new NotFoundException('Dossier file is no longer available');
  }

  async open(key: string) {
    try {
      const handle = await open(this.path(key), 'r');
      return handle.createReadStream();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      throw new NotFoundException('Dossier file is no longer available');
    }
  }

  async claim(m: EntityManager, id: number, actor: number, context: string, typeId: number): Promise<DossierFile> {
    const [file]: (DossierFile & { key: string })[] = await m.query(`
      SELECT id, original_name AS name, media_type AS "mediaType", size_bytes::int AS size, storage_key AS key
      FROM document_dossier_files WHERE id = $1 AND uploaded_by = $2 AND staging_context = $3
        AND staging_type_id = $4 AND committed_at IS NULL AND expires_at > now() FOR UPDATE`, [id, actor, context, typeId]);
    if (!file) throw new NotFoundException('Temporary dossier file is unavailable or has expired');
    await this.assertPresent(file.key);
    await m.query('UPDATE document_dossier_files SET committed_at = now(), expires_at = NULL WHERE id = $1', [id]);
    return { id: file.id, name: file.name, mediaType: file.mediaType, size: file.size };
  }

  async cleanup() {
    await this.ds.transaction(async m => {
      const rows: { id: number; storage_key: string }[] = await m.query(`
        SELECT id, storage_key FROM document_dossier_files f WHERE f.committed_at IS NULL AND f.expires_at <= now()
          AND NOT EXISTS (SELECT 1 FROM document_dossier_attachments a WHERE a.file_id = f.id)
        ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`);
      for (const row of rows) {
        await this.remove(row.storage_key);
        await m.query('DELETE FROM document_dossier_files WHERE id = $1', [row.id]);
      }
    });
    const files = await readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    // Recover filesystem writes whose DB transaction never committed.
    for (const key of files.filter(value => storageKey.test(value))) {
      const info = await stat(this.path(key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!info || Date.now() - info.mtimeMs <= stagingHours * 3600_000) continue;
      await this.ds.transaction(async m => {
        await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
        const existing = await m.query('SELECT id FROM document_dossier_files WHERE storage_key = $1', [key]);
        if (!existing.length) await this.remove(key);
      });
    }
  }
}
