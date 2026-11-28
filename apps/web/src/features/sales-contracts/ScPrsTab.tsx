import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ApprovalStatusChip, DataTable, ErrorAlert } from '../../shared/components';
import { pagePath } from '../../shared/navigation';
import { fmtDate } from '../../shared/utils/format';

interface PrRow { id: number; documentNumber: string; approvalStatus: string; category: string; createdAt: string; createdByName: string; assignedApproverName: string | null }

/** PRs linked by purchase_requisitions.sales_contract_id (not inferred from products). Shown only with PR.VIEW. */
export function ScPrsTab({ contractId }: { contractId: number }) {
  const { t } = useTranslation();
  const prs = useQuery({ queryKey: ['sc-prs', contractId], queryFn: () => api<PrRow[]>(`/purchase-requisitions?salesContractId=${contractId}`) });
  const columns: GridColDef<PrRow>[] = [
    {
      field: 'documentNumber', headerName: t('pr.number'), width: 170,
      renderCell: (p) => <Link component={RouterLink} to={pagePath('purchaseRequisitions', p.row.id)}>{p.value}</Link>,
    },
    { field: 'approvalStatus', headerName: t('common.status'), width: 140, renderCell: (p) => <ApprovalStatusChip status={p.value} /> },
    { field: 'category', headerName: t('pr.category'), width: 130, valueFormatter: (v: string) => t(`category.${v}`) },
    { field: 'createdByName', headerName: t('gr.createdBy'), flex: 1, minWidth: 150 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  if (prs.error) return <ErrorAlert error={prs.error} />;
  return <DataTable rows={prs.data ?? []} columns={columns} loading={prs.isLoading} emptyHint={t('sc.noPrs')} />;
}
