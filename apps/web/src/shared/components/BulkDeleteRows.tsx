import { useState } from 'react';
import { Button } from '@mui/material';
import Delete from '@mui/icons-material/DeleteOutlined';
import { useTranslation } from 'react-i18next';
import { FormDialog } from './FormDialog';

export function BulkDeleteRows<Key extends string | number>({ selected, disabled, onDelete }: {
  selected: ReadonlySet<Key>;
  disabled?: boolean;
  onDelete: (keys: ReadonlySet<Key>) => void;
}) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState<ReadonlySet<Key>>();
  return <>
    <Button variant="outlined" color="error" startIcon={<Delete />} disabled={disabled || !selected.size}
      onClick={() => setRequested(new Set(selected))}>
      {t('documentRows.bulkDelete', { count: selected.size })}
    </Button>
    {requested && <FormDialog title={t('documentRows.deleteItems')} submitLabel={t('documentRows.deleteItems')}
      submitColor="error" submitIcon={<Delete />} canSubmit={!disabled} pending={false} error={null}
      onClose={() => setRequested(undefined)} onSubmit={() => { onDelete(requested); setRequested(undefined); }}>
      {t('documentRows.confirmBulkDelete', { count: requested.size })}
    </FormDialog>}
  </>;
}
