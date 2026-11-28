import { MenuItem, TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ReadOnlyField } from '../../shared/components/ReadOnlyField';
import type { OwnerOrgUnit } from './api';

export function defaultOwnerOrgUnit(units: OwnerOrgUnit[]) {
  return units.find(unit => unit.isPrimary)?.id ?? (units.length === 1 ? units[0].id : undefined);
}

export function OwnerOrgUnitField({ units = [], value, onChange, name, invalid }: {
  units?: OwnerOrgUnit[]; value?: number; onChange?: (id: number) => void; name?: string | null; invalid?: boolean;
}) {
  const { t } = useTranslation();
  const selected = units.find(unit => unit.id === value);
  const label = t('scope.owner');
  if (!onChange || units.length <= 1) {
    return <ReadOnlyField label={label} value={name ?? (selected ? selected.code + ' · ' + selected.name : t('scope.noOwner'))} />;
  }
  return <TextField select fullWidth label={label} value={selected?.id ?? ''} error={invalid}
    onChange={event => onChange(Number(event.target.value))}>
    {units.map(unit => <MenuItem key={unit.id} value={unit.id}>{unit.code} · {unit.name}</MenuItem>)}
  </TextField>;
}
