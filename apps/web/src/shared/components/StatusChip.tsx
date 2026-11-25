import { useTranslation } from 'react-i18next';
import { Chip } from '@mui/material';
import { statusTones, StatusTone } from '../../config/theme';

export function StatusChip({ label, tone, prominent }: { label: string; tone: StatusTone; prominent?: boolean }) {
  const c = statusTones[tone];
  return <Chip size="small" label={label} sx={{ color: c.fg, bgcolor: c.bg, fontWeight: 600, borderRadius: 1,
    ...(prominent && { height: 30, fontSize: 14, '& .MuiChip-label': { px: 1.5 } }) }} />;
}

/** approval_status → tone (03 §6). Labels come from i18n `status.*`. */
export const approvalTone: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  WAITING_FOR_APPROVE: 'pending',
  WAITING_FOR_RECEIPT: 'pending',
  APPROVED: 'success',
  DONE: 'success',
  REJECTED: 'danger',
  CANCELED: 'muted',
};

export function ApprovalStatusChip({ status, prominent }: { status: string; prominent?: boolean }) {
  const { t } = useTranslation();
  return <StatusChip label={t(`status.${status}`)} tone={approvalTone[status] ?? 'neutral'} prominent={prominent} />;
}

export function ActiveChip({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return <StatusChip label={t(active ? 'common.active' : 'common.inactive')} tone={active ? 'success' : 'muted'} />;
}
