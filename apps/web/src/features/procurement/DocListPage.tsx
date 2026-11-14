import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, FormControlLabel } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import { StatusTone } from '../../config/theme';
import { api } from '../../services/api-client';
import { ApprovalStatusChip, DataTable, ListPageLayout, StatusChip } from '../../shared/components';
import { fmtDate } from '../../shared/utils/format';
import { useMe } from '../identity';
import { DocConfig, DocRow } from './types';
import { DocDetailView } from './DocDetailView';

const receiptTone: Record<string, StatusTone> = { NOT_RECEIVED: 'neutral', PARTIALLY_RECEIVED: 'pending', RECEIVED: 'success' };
export function ReceiptStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  return <StatusChip label={t(`po.receipt.${status}`)} tone={receiptTone[status] ?? 'neutral'} />;
}

export function DocListPage({ cfg }: { cfg: DocConfig }) {
  const { t } = useTranslation();
  const me = useMe();
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState(false);
  const list = useQuery({ queryKey: [cfg.key, 'list', mine], queryFn: () => api<DocRow[]>(`/${cfg.path}?assignedToMe=${mine}`) });
  if (openId) return <DocDetailView cfg={cfg} id={openId} onBack={() => setOpenId(null)} />;
  const columns: GridColDef<DocRow>[] = [
    { field: 'documentNumber', headerName: t(`${cfg.key}.number`), width: 170 },
    { field: 'approvalStatus', headerName: t('common.status'), width: 150, renderCell: (p) => <ApprovalStatusChip status={p.value} /> },
    ...cfg.columns(t),
    { field: 'createdByName', headerName: t('gr.createdBy'), width: 160 },
    { field: 'assignedApproverName', headerName: t('gr.approver'), flex: 1, minWidth: 140 },
    { field: 'createdAt', headerName: t('gr.createdAt'), width: 170, valueFormatter: fmtDate },
  ];
  const canCreate = me.data?.permissions.includes(`${cfg.perm}.CREATE`);
  return (
    <>
      <ListPageLayout
        title={t(`${cfg.key}.title`)} error={list.error}
        actions={canCreate && <Button variant="contained" onClick={() => setCreating(true)}>{t(`${cfg.key}.create`)}</Button>}
        toolbar={<FormControlLabel control={<Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)} />} label={t('doc.waitingForMe')} />}
      >
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t(`${cfg.key}.empty`)}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </ListPageLayout>
      {creating && <cfg.Create onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </>
  );
}
