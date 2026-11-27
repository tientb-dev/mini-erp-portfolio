import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Autocomplete, TextField } from '@mui/material';
import type { SxProps } from '@mui/material';
import { useDebouncedText, useServerList } from '../../shared/utils/server-list';

/**
 * Single choice over a server-side Common List API (search sent as `q`, first page of 25 by `sort`): no client cap, so a
 * catalog of any size stays reachable by typing. `fixed` adds query params (e.g. only active rows); `exclude` hides one id.
 */
export function ServerAutocomplete<T extends { id: number }>({ path, fixed = {}, sort, label, getLabel, value, onChange, exclude, required, error,
  helperText, disabled, placeholder, sx, size = 'small' }: {
  path: string; fixed?: Record<string, string>; sort: string; label: string; getLabel: (row: T) => string; value: T | null; onChange: (value: T | null) => void;
  exclude?: number; required?: boolean; error?: string; helperText?: string; disabled?: boolean; placeholder?: string; sx?: SxProps; size?: 'small' | 'medium';
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebouncedText(q);
  const params = new URLSearchParams({ ...fixed, size: '25', page: '0', sort, direction: 'asc' });
  if (debounced.trim()) params.set('q', debounced.trim());
  const list = useServerList<T>(path, params, open && !disabled);
  const options = (list.data?.items ?? []).filter(row => row.id !== exclude);
  return <Autocomplete size={size} value={value} options={options} disabled={disabled} loading={list.isFetching} sx={sx}
    open={open} onOpen={() => setOpen(true)} onClose={() => { setOpen(false); setQ(''); }}
    filterOptions={x => x} isOptionEqualToValue={(a, b) => a.id === b.id} getOptionLabel={getLabel}
    onInputChange={(_e, text, reason) => { if (reason === 'input') setQ(text); }} onChange={(_e, next) => onChange(next)}
    noOptionsText={t('users.noOptionMatch')} loadingText={t('common.loading')}
    renderInput={props => <TextField {...props} label={label} required={required} error={Boolean(error)} helperText={error ?? helperText}
      placeholder={placeholder} slotProps={{ ...props.slotProps, inputLabel: { shrink: true } }} />} />;
}
