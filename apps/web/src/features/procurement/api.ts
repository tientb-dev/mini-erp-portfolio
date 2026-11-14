import { api } from '../../services/api-client';
import { DocDetail } from './types';

/** POST a new document, or PATCH `edit` with its version (stale data → 409 STALE_VERSION). */
export async function saveDoc(path: string, edit: DocDetail | undefined, body: object): Promise<{ id: number }> {
  if (!edit) return api<{ id: number }>(`/${path}`, { method: 'POST', body: JSON.stringify(body) });
  await api(`/${path}/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ ...body, version: edit.version }) });
  return { id: edit.id };
}
