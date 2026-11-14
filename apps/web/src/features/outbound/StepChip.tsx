import { useTranslation } from 'react-i18next';
import { ApprovalStatusChip, StatusChip } from '../../shared/components';

export function StepChip({ d }: { d: { approvalStatus: string; approvalStep: number | null } }) {
  const { t } = useTranslation();
  return d.approvalStatus === 'WAITING_FOR_APPROVE' && d.approvalStep
    ? <StatusChip label={t(`gir.step${d.approvalStep}`)} tone="pending" />
    : <ApprovalStatusChip status={d.approvalStatus} />;
}
