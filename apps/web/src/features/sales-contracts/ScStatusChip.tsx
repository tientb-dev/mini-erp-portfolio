import { useTranslation } from 'react-i18next';
import { StatusChip } from '../../shared/components';
import { StatusTone } from '../../config/theme';

const scTone: Record<string, StatusTone> = { DRAFT: 'neutral', ACTIVE: 'success', CANCELED: 'muted' };

export function ScStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  return <StatusChip label={t(`sc.status.${status}`)} tone={scTone[status] ?? 'neutral'} />;
}
