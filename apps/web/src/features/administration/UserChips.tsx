import { useTranslation } from 'react-i18next';
import CheckCircle from '@mui/icons-material/CheckCircle';
import { StatusChip } from '../../shared/components';
import type { StatusTone } from '../../config/theme';
import type { AccountStatus } from './users-api';

/** BA-USR-03: employment and account are two statuses, each with its own badge. */
export function EmploymentChip({ status, prominent }: { status: 'ACTIVE' | 'INACTIVE'; prominent?: boolean }) {
  const { t } = useTranslation();
  return <StatusChip prominent={prominent} label={t(`users.employment.${status}`)} tone={status === 'ACTIVE' ? 'success' : 'muted'} />;
}

const ACCOUNT_TONE: Record<AccountStatus, StatusTone> = { ACTIVE: 'success', INACTIVE: 'muted', LOCKED: 'danger', NONE: 'neutral' };
export function AccountChip({ status }: { status: AccountStatus }) {
  const { t } = useTranslation();
  return <StatusChip label={t(`users.account.${status}`)} tone={ACCOUNT_TONE[status]} />;
}

/** Yes-mark for a boolean column (primary unit, unit head): the same check on the User and Organization screens. */
export function CheckMark({ label }: { label: string }) {
  return <CheckCircle fontSize="small" color="success" aria-label={label} titleAccess={label} sx={{ verticalAlign: 'middle' }} />;
}
