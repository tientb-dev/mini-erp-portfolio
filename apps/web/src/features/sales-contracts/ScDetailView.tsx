import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Paper, Stack } from '@mui/material';
import { api } from '../../services/api-client';
import { DetailPageLayout, DetailTabs, Field, PageBreadcrumbs } from '../../shared/components';
import { fmtDate } from '../../shared/utils/format';
import { useMe } from '../identity';
import { DecideDialog, DeleteLineDialog, ProposeDialog, ScStatusDialog } from './ScDialogs';
import { ScHeaderDialog } from './ScHeaderDialog';
import { ScLineDialog } from './ScLineDialog';
import { LineAction, ScLinesTab } from './ScLinesTab';
import { ScPrsTab } from './ScPrsTab';
import { ScStatusChip } from './ScStatusChip';
import { listUrl, ScDetail } from './types';

type Dialog = LineAction | { kind: 'activate' | 'cancel' | 'header' };

/**
 * HĐ detail: header always visible, tabs Hàng hóa (default) and Đề nghị mua. Every save (header, one line, status)
 * is its own API call; there is no "save all". No History tab: the backend keeps no audit trail for HĐ yet.
 */
export function ScDetailView({ id }: { id: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useMe();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const sc = useQuery({ queryKey: ['sc', id], queryFn: () => api<ScDetail>(`/sales-contracts/${id}`) });
  const d = sc.data;
  const can = (p: string) => Boolean(me.data?.permissions.includes(p));
  const close = () => setDialog(null);
  const done = () => { close(); void qc.invalidateQueries({ queryKey: ['sc', id] }); void qc.invalidateQueries({ queryKey: ['scs'] }); };
  const breadcrumbs = (
    <PageBreadcrumbs items={[{ label: t('common.home'), to: '/' }, { label: t('nav.sales') }, { label: t('nav.salesContracts'), to: listUrl() }, { label: d?.documentNumber ?? '…' }]} />
  );
  const manage = can('SALES_CONTRACT.CREATE');
  const actions = d && manage && d.status !== 'CANCELED' && (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Button color="error" onClick={() => setDialog({ kind: 'cancel' })}>{t('sc.cancel')}</Button>
      {d.status === 'DRAFT' && <Button variant="outlined" onClick={() => setDialog({ kind: 'header' })}>{t('sc.editHeader')}</Button>}
      {d.status === 'DRAFT' && <Button variant="contained" onClick={() => setDialog({ kind: 'activate' })}>{t('sc.activate')}</Button>}
    </Stack>
  );
  return (
    <DetailPageLayout title={t('sc.title')} documentNumber={d?.documentNumber} loading={!d || !me.data} error={sc.error ?? me.error}
      breadcrumbs={breadcrumbs} backTo={listUrl()} status={d && <ScStatusChip status={d.status} />} actions={actions}>
      {d && (
        <>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={1}>
              <Field label={t('sc.customer')}>{d.customerCode}: {d.customerName}</Field>
              <Field label={t('sc.responsibleSales')}>{d.responsibleSalesName ?? t('sc.noResponsibleSales')}</Field>
              <Field label={t('gr.createdBy')}>{d.createdByName}, {fmtDate(d.createdAt)}</Field>
              {d.updatedAt && <Field label={t('sc.updatedBy')}>{d.updatedByName ?? ''}, {fmtDate(d.updatedAt)}</Field>}
            </Stack>
          </Paper>
          <DetailTabs tabs={[
            { key: 'lines', label: `${t('sc.tabLines')} (${d.lines.length})`, content: <ScLinesTab d={d} can={can} onAction={setDialog} /> },
            { key: 'prs', label: t('sc.tabPrs'), hidden: !can('PR.VIEW'), content: <ScPrsTab contractId={d.id} /> },
          ]} />
          {(dialog?.kind === 'activate' || dialog?.kind === 'cancel') && <ScStatusDialog id={id} kind={dialog.kind} onClose={close} onDone={done} />}
          {dialog?.kind === 'header' && <ScHeaderDialog edit={d} onClose={close} onSaved={done} />}
          {dialog?.kind === 'add' && <ScLineDialog contractId={id} version={d.version} onClose={close} onSaved={done} />}
          {dialog?.kind === 'edit' && <ScLineDialog contractId={id} version={d.version} line={dialog.line} onClose={close} onSaved={done} />}
          {dialog?.kind === 'delete' && <DeleteLineDialog line={dialog.line} version={d.version} onClose={close} onDone={done} />}
          {dialog?.kind === 'propose' && <ProposeDialog line={dialog.line} onClose={close} onDone={done} />}
          {(dialog?.kind === 'approve' || dialog?.kind === 'reject') && (
            <DecideDialog proposal={dialog.proposal} approve={dialog.kind === 'approve'} onClose={close} onDone={done} />
          )}
        </>
      )}
    </DetailPageLayout>
  );
}
