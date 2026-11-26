import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormDialog } from './FormDialog';
import { ActionButton } from './ActionButton';

export function BulkDeleteRows<Key extends string | number>({ selected, disabled, onDelete }: {
  selected: ReadonlySet<Key>;
  disabled?: boolean;
  onDelete: (keys: ReadonlySet<Key>) => void;
}) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState<ReadonlySet<Key>>();
  return <>
    <ActionButton action="delete" disabled={disabled || !selected.size}
      onClick={() => setRequested(new Set(selected))}>
      {t('documentRows.bulkDelete', { count: selected.size })}
    </ActionButton>
    {requested && <FormDialog title={t('documentRows.deleteItems')} submitLabel={t('documentRows.deleteItems')}
      submitAction="delete" canSubmit={!disabled} pending={false} error={null}
      onClose={() => setRequested(undefined)} onSubmit={() => { onDelete(requested); setRequested(undefined); }}>
      {t('documentRows.confirmBulkDelete', { count: requested.size })}
    </FormDialog>}
  </>;
}
