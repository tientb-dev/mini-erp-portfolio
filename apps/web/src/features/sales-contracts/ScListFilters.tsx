import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MenuItem, TextField } from '@mui/material';
import { FilterToolbar } from '../../shared/components';
import { SearchInput } from '../../shared/components/SearchInput';

type Option = { value: string; label: string };

/**
 * One compact filter control: no label above (the toolbar is not a form); the empty value reads "Tất cả …" and the
 * accessible name is the field name. Width follows the content it holds.
 */
function FilterSelect({ name, empty, value, options, width, onChange }: {
  name: string; empty: string; value: string; options: Option[]; width: number; onChange: (v: string) => void;
}) {
  return (
    <TextField select value={value} onChange={(e) => onChange(e.target.value)} sx={{ width: { xs: '100%', sm: width }, flexShrink: 0 }}
      slotProps={{ select: { displayEmpty: true, SelectDisplayProps: { 'aria-label': name } } }}>
      <MenuItem value="">{empty}</MenuItem>
      {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
    </TextField>
  );
}

/** Search + status/sales/customer filters in the shared FilterToolbar; clearing keeps sort and page size, back to page 1. */
export function ScListFilters({ text, onText, params, update, salesOptions, customerOptions }: {
  text: string; onText: (v: string) => void; params: URLSearchParams; update: (next: Record<string, string | null>) => void;
  salesOptions?: Option[]; customerOptions?: Option[];
}) {
  const { t } = useTranslation();
  const active = Boolean(text || params.get('status') || params.get('responsibleSalesUserId') || params.get('customerId'));
  const filters: ReactNode[] = [
    <FilterSelect key="status" name={t('common.status')} empty={t('sc.allStatuses')} width={170} value={params.get('status') ?? ''}
      options={['DRAFT', 'ACTIVE', 'CANCELED'].map((s) => ({ value: s, label: t(`sc.status.${s}`) }))} onChange={(v) => update({ status: v })} />,
  ];
  if (salesOptions) {
    filters.push(<FilterSelect key="sales" name={t('sc.responsibleSales')} empty={t('sc.allSales')} width={200} value={params.get('responsibleSalesUserId') ?? ''}
      options={salesOptions} onChange={(v) => update({ responsibleSalesUserId: v })} />);
  }
  if (customerOptions) {
    filters.push(<FilterSelect key="customer" name={t('sc.customer')} empty={t('sc.allCustomers')} width={240} value={params.get('customerId') ?? ''}
      options={customerOptions} onChange={(v) => update({ customerId: v })} />);
  }
  return (
    <FilterToolbar active={active} onClear={() => { onText(''); update({ q: null, status: null, responsibleSalesUserId: null, customerId: null }); }}>
      <SearchInput label={t('common.search')} value={text} onChange={onText} placeholder={t('searchFields.contract')}
        sx={{ flex: { xs: '1 1 100%', sm: '1 1 260px' }, maxWidth: { sm: 360 } }} />
      {filters}
    </FilterToolbar>
  );
}
