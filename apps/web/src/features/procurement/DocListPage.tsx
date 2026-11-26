import { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, FormControlLabel } from '@mui/material';
import { GridColDef } from '@mui/x-data-grid';
import Add from '@mui/icons-material/Add';
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

export function DocListPage({ cfg, initialId }: { cfg: DocConfig; initialId?: number }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const { search } = useLocation();
  const Create = cfg.Create;
  const [inListId, setOpenId] = useState<number | null>(null);
  const openId = initialId ?? inListId;
  const [creating, setCreating] = useState(false);
  const [mine, setMine] = useState(false);
  const [params, setParams] = useSearchParams();
  const isPr = cfg.key === 'pr';
  const currentPage = Number(params.get('page'));
  const pageSize = Number(params.get('size'));
  const page = { page: Number.isSafeInteger(currentPage) && currentPage > 0 ? currentPage : 0,
    pageSize: [10, 25, 50, 100].includes(pageSize) ? pageSize : 25 };
  const assigned = isPr ? params.get('mine') === 'true' : mine;
  // Opened through a narrower read scope (no list permission, ADR-0014): no list query; Back returns to where the user came from.
  const listAllowed = Boolean(me.data?.permissions.includes(`${cfg.perm}.VIEW`)
    || (cfg.key === 'pr' && me.data?.permissions.some(permission => ['PR.CREATE', 'PR.APPROVE', 'PR.RECEIVE'].includes(permission))));
  const list = useQuery({ queryKey: [cfg.key, 'list', assigned], queryFn: () => api<DocRow[]>(`/${cfg.path}?assignedToMe=${assigned}`), enabled: listAllowed && openId === null });
  if (openId !== null) return <DocDetailView key={openId} cfg={cfg} id={openId} onBack={() => {
    if (!listAllowed) navigate(-1);
    else if (isPr && initialId !== undefined) navigate(`/${cfg.path}${search}`);
    else setOpenId(null);
  }} />;
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
        actions={canCreate && <Button variant="contained" startIcon={isPr ? <Add /> : undefined} onClick={() => isPr ? navigate(`/${cfg.path}/new${search}`) : setCreating(true)}>{t(`${cfg.key}.create`)}</Button>}
        toolbar={<FormControlLabel control={<Checkbox checked={assigned} onChange={(e) => {
          const checked = e.target.checked;
          if (!isPr) { setMine(checked); return; }
          setParams(previous => {
            const next = new URLSearchParams(previous);
            if (checked) next.set('mine', 'true'); else next.delete('mine');
            next.delete('page');
            return next;
          }, { replace: true });
        }} />} label={t('doc.waitingForMe')} />}
      >
        <DataTable rows={list.data ?? []} columns={columns} loading={list.isLoading} emptyHint={t(`${cfg.key}.empty`)}
          paginationModel={isPr ? page : undefined} onPaginationModelChange={isPr && list.isSuccess ? model => {
            if (model.page === page.page && model.pageSize === page.pageSize) return;
            setParams(previous => {
              const next = new URLSearchParams(previous);
              if (model.page) next.set('page', String(model.page)); else next.delete('page');
              if (model.pageSize !== 25) next.set('size', String(model.pageSize)); else next.delete('size');
              return next;
            }, { replace: true });
          } : undefined}
          onRowClick={(p) => setOpenId(Number(p.id))} sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </ListPageLayout>
      {creating && Create && <Create onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    </>
  );
}
