import { useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, apiResponse } from '../../services/api-client';
import { formatDocumentDate, parseDocumentDate } from '../../shared/utils/document-date';

export type DossierFile = { id: number; name: string };
type DossierType = { dossierTypeId: number; code: string; name: string; position: number };
export type PrDossierRow = DossierType & {
  hasPaper: boolean; issuedOn: string | null; issuer: string | null; note: string | null; version: number; file: DossierFile | null;
};
type DossierTemplate = { revision: string; rows: DossierType[] };
type SavedDossier = { rows: PrDossierRow[]; canManage: boolean };
type Editable = { hasPaper: boolean; date: string; issuer: string; note: string; file: DossierFile | null };
const paper = (row: PrDossierRow): Editable => ({
  hasPaper: row.hasPaper, date: formatDocumentDate(row.issuedOn ?? '', 'vi'), issuer: row.issuer ?? '', note: row.note ?? '', file: row.file,
});

export function usePrDossier(id: number, enabled: boolean, canCreateManage: boolean) {
  const [editing, setEditing] = useState<Map<number, Editable>>(new Map());
  const [working, setWorking] = useState<Set<number>>(new Set());
  const [template, setTemplate] = useState<DossierTemplate>();
  const [base, setBase] = useState<PrDossierRow[]>();
  const session = useRef<string | undefined>(undefined);
  const formId = useId();
  const qc = useQueryClient();
  const sessionKey = () => session.current ??= crypto.randomUUID();
  const basePath = '/purchase-requisitions';
  const path = `${basePath}/${id}/dossier`;
  const queryKey = id ? ['pr-dossier', id] : ['pr-dossier', 0, formId];
  const query = useQuery<SavedDossier | DossierTemplate>({ queryKey, enabled, staleTime: id ? 0 : Infinity,
    queryFn: () => id ? api<SavedDossier>(path) : api<DossierTemplate>(`${basePath}/catalog/dossier`) });
  const server = query.data && 'revision' in query.data ? query.data : undefined;
  const saved = query.data && 'canManage' in query.data ? query.data : undefined;
  const current = template ?? server;
  const rows = id ? base ?? saved?.rows ?? [] : (current?.rows ?? []).map<PrDossierRow>(row => ({
    ...row, version: 0, hasPaper: false, issuedOn: null, issuer: null, note: null, file: null,
  }));
  const pending = working.size > 0;
  const dirty = editing.size > 0;
  const values = (row: PrDossierRow) => editing.get(row.dossierTypeId) ?? paper(row);
  const invalid = [...editing.values()].some(row => Boolean(row.date && !parseDocumentDate(row.date, 'vi')));
  const patches = rows.flatMap(row => {
    if (!editing.has(row.dossierTypeId)) return [];
    const v = values(row);
    return [{ dossierTypeId: row.dossierTypeId, version: row.version, hasPaper: v.hasPaper,
      issuedOn: parseDocumentDate(v.date, 'vi') || null, issuer: v.issuer || null, note: v.note || null, fileId: v.file?.id ?? null }];
  });
  const payload = id ? (dirty ? { rows: patches, sessionKey: sessionKey() } : undefined)
    : (current ? { revision: current.revision, rows: patches, ...(dirty && { sessionKey: sessionKey() }) } : undefined);
  function update(row: PrDossierRow, change: Partial<Editable>) {
    if (id) setBase(previous => previous ?? rows);
    else if (current) setTemplate(previous => previous ?? current);
    setEditing(previous => {
      const next = new Map(previous);
      const original = paper(row);
      const edited = { ...(previous.get(row.dossierTypeId) ?? original), ...change };
      if (JSON.stringify(edited) === JSON.stringify(original)) next.delete(row.dossierTypeId);
      else next.set(row.dossierTypeId, edited);
      return next;
    });
  }
  function revert() { setEditing(new Map()); setBase(undefined); setTemplate(undefined); }
  async function refreshTemplate(discardRemoved = false) {
    const latest = (await query.refetch()).data;
    if (!latest || !('revision' in latest)) throw new Error('Dossier configuration could not be refreshed.');
    const allowed = new Set(latest.rows.map(row => row.dossierTypeId));
    if ([...editing.keys()].some(key => !allowed.has(key))) {
      if (!discardRemoved) return false;
      setEditing(previous => new Map([...previous].filter(([key]) => allowed.has(key))));
    }
    setTemplate(latest);
    return true;
  }
  async function upload(row: PrDossierRow, file: File) {
    if (!id && current) setTemplate(previous => previous ?? current);
    const typeId = row.dossierTypeId;
    setWorking(previous => new Set(previous).add(typeId));
    try {
      const form = new FormData();
      form.append('file', file);
      const target = id ? `${path}/files/${typeId}?session=${sessionKey()}` : `${basePath}/dossier-staging/${sessionKey()}/${typeId}`;
      update(row, { file: await api<DossierFile>(target, { method: 'POST', body: form }) });
    } finally {
      setWorking(previous => { const result = new Set(previous); result.delete(typeId); return result; });
    }
  }
  async function download(file: DossierFile) {
    const sessionQuery = session.current ? `?session=${session.current}` : '';
    const target = id ? `${path}/files/${file.id}${sessionQuery}` : `${basePath}/dossier-staging/${sessionKey()}/${file.id}`;
    const url = URL.createObjectURL(await (await apiResponse(target)).blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function save() {
    if (!id || !payload || pending || invalid) throw new ApiError(400, 'PR_DOSSIER_INVALID', 'Check dossier fields before saving.');
    const latest = await api<SavedDossier>(path, { method: 'PUT', body: JSON.stringify(payload) });
    qc.setQueryData(queryKey, latest);
    revert();
    return latest;
  }
  return { rows, values, update, upload, download, pending, working, dirty, invalid, payload, save, revert, refreshTemplate,
    canManage: id ? saved?.canManage ?? false : canCreateManage, loading: query.isLoading, error: query.error };
}

export type PrDossierModel = ReturnType<typeof usePrDossier>;
