import { useTranslation } from 'react-i18next';
import { Chip } from '@mui/material';
import { statusTones, StatusTone } from '../../config/theme';

export function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  const c = statusTones[tone];
  return <Chip size="small" label={label} sx={{ color: c.fg, bgcolor: c.bg, fontWeight: 600, borderRadius: 1 }} />;
}

/** approval_status → tone (03 §6). Labels come from i18n `status.*`. */
export const approvalTone: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  WAITING_FOR_APPROVE: 'pending',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELED: 'muted',
};

export function ApprovalStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  return <StatusChip label={t(`status.${status}`)} tone={approvalTone[status] ?? 'neutral'} />;
}

export function ActiveChip({ active }: { active: boolean }) {
  const { t } = useTranslation();
  return <StatusChip label={t(active ? 'common.active' : 'common.inactive')} tone={active ? 'success' : 'muted'} />;
}
