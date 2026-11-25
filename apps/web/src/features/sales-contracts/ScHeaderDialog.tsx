import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MenuItem, TextField } from '@mui/material';
import { api, catalogSelectionPath } from '../../services/api-client';
import { FormDialog } from '../../shared/components';

type Header = { id: number; documentNumber: string; version: number; customerId: number; responsibleSalesUserId: number | null };

/** Contract header only (customer, responsible sales). Creates a DRAFT, or with `edit` saves the header of a DRAFT (lines untouched). */
export function ScHeaderDialog({ edit, onClose, onSaved }: { edit?: Header; onClose: () => void; onSaved: (id: number) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const initial = { customerId: edit ? String(edit.customerId) : '', sales: edit?.responsibleSalesUserId ? String(edit.responsibleSalesUserId) : '' };
  const [customerId, setCustomerId] = useState(initial.customerId);
  const [sales, setSales] = useState(initial.sales);
  const customers = useQuery({ queryKey: ['customers', 'selection', edit?.customerId], queryFn: () => api<{ id: number; code: string; name: string }[]>(catalogSelectionPath('/customers', edit?.customerId)) });
  const salesUsers = useQuery({ queryKey: ['responsible-sales'], queryFn: () => api<{ id: number; fullName: string }[]>('/sales-contracts/responsible-sales-candidates') });
  const save = useMutation({
    mutationFn: async () => {
      const body = { customerId: Number(customerId), responsibleSalesUserId: sales ? Number(sales) : null };
      if (!edit) return api<{ id: number }>('/sales-contracts', { method: 'POST', body: JSON.stringify(body) });
      await api(`/sales-contracts/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ ...body, version: edit.version }) });
      return { id: edit.id };
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['scs'] }); void qc.invalidateQueries({ queryKey: ['sc', r.id] }); onSaved(r.id); },
  });
  return (
    <FormDialog title={edit ? t('sc.editHeaderTitle', { number: edit.documentNumber }) : t('sc.create')} submitLabel={t(edit ? 'doc.saveEdit' : 'sc.create')}
      error={save.error} pending={save.isPending} canSubmit={Boolean(customerId)} onSubmit={() => save.mutate()} onClose={onClose}
      dirty={customerId !== initial.customerId || sales !== initial.sales} description={edit ? undefined : t('sc.createHint')}>
      <TextField select label={t('sc.customer')} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required autoFocus
        helperText={customers.data?.length === 0 ? t('sc.noCustomer') : undefined}>
        {(customers.data ?? []).map((c) => <MenuItem key={c.id} value={c.id}>{c.code}: {c.name}</MenuItem>)}
      </TextField>
      <TextField select label={t('sc.responsibleSales')} value={sales} onChange={(e) => setSales(e.target.value)} helperText={t('sc.responsibleSalesHint')}>
        <MenuItem value="">{t('sc.noResponsibleSales')}</MenuItem>
        {(salesUsers.data ?? []).map((u) => <MenuItem key={u.id} value={u.id}>{u.fullName}</MenuItem>)}
      </TextField>
    </FormDialog>
  );
}
