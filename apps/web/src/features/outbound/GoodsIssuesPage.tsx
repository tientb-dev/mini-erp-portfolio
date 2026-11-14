import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { ApprovalStatusChip, DataTable, ErrorAlert, PageHeader } from '../../shared/components';
import { fmtDate } from '../../shared/utils/format';
import { GiRow } from './types';
import { GiDetailView } from './GiDetailView';

export function GoodsIssuesPage() {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<number | null>(null);
  const [mine, setMine] = useState(false);
  const list = useQuery({ queryKey: ['gis', mine], queryFn: () => api<GiRow[]>(`/goods-issues?assignedToMe=${mine}`) });
  if (openId) return <GiDetailView id={openId} onBack={() => setOpenId(null)} />;
  const columns: GridColDef<GiRow>[] = [
    { field: 'documentNumber', headerName: t('gi.number'), width: 170 },
    { field: 'approvalStatus', headerName: t('common.status'), width: 150, renderCell: (p) => <ApprovalStatusChip status={p.value} /> },
    { field: 'girNumber', headerName: t('gi.gir'), width: 170 },
    { field: 'warehouseCode', headerName: t('inventory.warehouse'), width: 90 },
    { field: 'createdByName', headerName: t('gr.createdBy'), flex: 1, minWidth: 140 },
    { field: 'assignedApproverName', headerName: t('gr.approver'), flex: 1, minWidth: 140 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  return (
    <>
      <PageHeader title={t('nav.goodsIssues')} />
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">{t('gi.listHint')}</Typography>
        <FormControlLabel control={<Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />} label={t('gr.waitingForMe')} />
        <ErrorAlert error={list.error} />
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t('gi.empty')}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Stack>
    </>
  );
}
