import { GirDetailView } from './GirDetailView';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, FormControlLabel, Stack } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { api } from '../../services/api-client';
import { DataTable, ErrorAlert, PageHeader } from '../../shared/components';
import { fmtDate } from '../../shared/utils/format';
import { useMe } from '../identity';
import { ExecutionChip } from './ExecutionChip';
import { StepChip } from './StepChip';
import { CreateGirDialog } from './CreateGirDialog';
import { GirRow } from './types';

export function GoodsIssueRequestsPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState(false);
  const list = useQuery({ queryKey: ['girs', mine], queryFn: () => api<GirRow[]>(`/goods-issue-requests?assignedToMe=${mine}`) });
  if (openId) return <GirDetailView id={openId} onBack={() => setOpenId(null)} />;
  const columns: GridColDef<GirRow>[] = [
    { field: 'documentNumber', headerName: t('gir.number'), width: 170 },
    { field: 'issueType', headerName: t('gir.type'), width: 160, valueFormatter: (v: string) => t(`gir.types.${v}`) },
    { field: 'approvalStatus', headerName: t('common.status'), width: 190, renderCell: (p) => <StepChip d={p.row} /> },
    { field: 'executionStatus', headerName: t('gir.execution'), width: 140, renderCell: (p) => <ExecutionChip status={p.value} /> },
    { field: 'salesContractNumber', headerName: t('gir.salesContract'), width: 160 },
    { field: 'warehouseCode', headerName: t('inventory.warehouse'), width: 90 },
    { field: 'assignedApproverName', headerName: t('gr.approver'), flex: 1, minWidth: 140 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  return (
    <>
      <PageHeader title={t('nav.goodsIssueRequests')} action={me.data?.permissions.includes('GIR.CREATE') && <Button variant="contained" onClick={() => setCreating(true)}>{t('gir.create')}</Button>} />
      <Stack spacing={2}>
        <FormControlLabel control={<Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />} label={t('gr.waitingForMe')} />
        <ErrorAlert error={list.error} />
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t('gir.empty')}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Stack>
      {creating && <CreateGirDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </>
  );
}
