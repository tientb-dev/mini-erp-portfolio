import { useTranslation } from 'react-i18next';
import { StatusChip } from '../../shared/components';

export function ExecutionChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone = status === 'COMPLETED' ? 'success' : status === 'IN_PROGRESS' ? 'pending' : 'neutral';
  return <StatusChip label={t(`execution.${status}`)} tone={tone} />;
}
