import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { fmtDate, fmtDateTime } from '../utils/format';

export interface ActivityEntry { id: number; action: string; createdAt: string; actorName: string; metadata: Record<string, unknown> | null }

/**
 * COMMON-ACTIVITY-001: Activity History of an administration object (role, user, organization…). Newest first (API order).
 * Columns: time, actor, action, change. The change reads the Activity metadata conventions written by the API:
 * `before`/`after` objects (field changes), arrays of codes or `{ username|code, name|fullName }` refs (added/removed items),
 * `copiedFrom` (source object). No raw JSON is shown. Document workflows keep DocumentHistoryTable (rounds and statuses).
 */
export function ActivityHistoryTable({ entries, actionLabel, fieldLabel, listLabel, formatItem, scalarFields = [], withSeconds, actorLabel }: {
  entries: ActivityEntry[];
  /** Label of a structured list item the default `{code|username, name|fullName}` reading does not cover (e.g. a membership). */
  formatItem?: (item: unknown) => string | undefined;
  /** Plain metadata fields shown as "label: value" (e.g. `username` of an account event); others stay hidden. */ scalarFields?: string[];
  /** Times to the second (security events). */ withSeconds?: boolean;
  /** Display name of the actor (e.g. an automatic event); the stored actor is unchanged. */ actorLabel?: (entry: ActivityEntry) => string;
  actionLabel: (action: string) => string;
  /** Label of a `before`/`after` field. */ fieldLabel: (field: string) => string;
  /** Label of an item list (`permissions`, `users`…) for this action. */ listLabel: (key: string, action: string) => string;
}) {
  const { t } = useTranslation();
  if (!entries.length) return <Typography variant="body2" color="text.secondary">{t('activity.empty')}</Typography>;
  return (
    <TableContainer>
      <Table size="small" aria-label={t('activity.title')}>
        <TableHead><TableRow>
          <TableCell sx={{ width: 170 }}>{t('activity.time')}</TableCell>
          <TableCell sx={{ width: 200 }}>{t('activity.actor')}</TableCell>
          <TableCell sx={{ width: 200 }}>{t('activity.action')}</TableCell>
          <TableCell>{t('activity.change')}</TableCell>
        </TableRow></TableHead>
        <TableBody>{entries.map(entry => (
          <TableRow key={entry.id} sx={{ verticalAlign: 'top' }}>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{withSeconds ? fmtDateTime(entry.createdAt) : fmtDate(entry.createdAt)}</TableCell>
            <TableCell sx={{ overflowWrap: 'anywhere' }}>{actorLabel?.(entry) ?? entry.actorName}</TableCell>
            <TableCell>{actionLabel(entry.action)}</TableCell>
            <TableCell><Changes entry={entry} fieldLabel={fieldLabel} listLabel={listLabel} formatItem={formatItem} scalarFields={scalarFields} /></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </TableContainer>
  );
}

const show = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : typeof value === 'object' ? itemLabel(value) : String(value));
function itemLabel(item: unknown): string {
  if (typeof item !== 'object' || item === null) return String(item);
  const ref = item as { code?: string; username?: string; employeeCode?: string; name?: string; fullName?: string };
  const key = ref.code ?? ref.username ?? ref.employeeCode;
  const name = ref.name ?? ref.fullName;
  return key && name ? `${key} (${name})` : key ?? name ?? '';
}

function Changes({ entry, fieldLabel, listLabel, formatItem, scalarFields }: {
  entry: ActivityEntry; fieldLabel: (field: string) => string; listLabel: (key: string, action: string) => string; formatItem?: (item: unknown) => string | undefined;
  scalarFields: string[];
}) {
  const { t } = useTranslation();
  const m = entry.metadata ?? {};
  const before = (m.before ?? null) as Record<string, unknown> | null;
  const after = (m.after ?? null) as Record<string, unknown> | null;
  const lines: ReactNode[] = [];
  for (const field of [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]) {
    const from = before?.[field];
    const to = after?.[field];
    if (before && from === to) continue;
    lines.push(<Typography key={`f-${field}`} variant="body2">
      <strong>{fieldLabel(field)}:</strong> {before ? <>{show(from)} → {show(to)}</> : show(to)}
    </Typography>);
  }
  for (const field of scalarFields) if (m[field] !== undefined && m[field] !== null && typeof m[field] !== 'object') {
    lines.push(<Typography key={`s-${field}`} variant="body2"><strong>{fieldLabel(field)}:</strong> {show(m[field])}</Typography>);
  }
  if (m.copiedFrom) lines.push(<Typography key="copied" variant="body2">{t('activity.copiedFrom', { source: itemLabel(m.copiedFrom) })}</Typography>);
  for (const [key, value] of Object.entries(m)) {
    if (!Array.isArray(value) || !value.length) continue;
    lines.push(<Typography key={`l-${key}`} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
      <strong>{listLabel(key, entry.action)} ({value.length}):</strong> {value.map(item => formatItem?.(item) ?? itemLabel(item)).join(', ')}
    </Typography>);
  }
  return lines.length ? <Stack spacing={0.25}>{lines}</Stack> : <Typography variant="body2" color="text.secondary">—</Typography>;
}
