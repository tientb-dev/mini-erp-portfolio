import { ReactNode } from 'react';
import { Stack } from '@mui/material';
import { ErrorAlert } from './ErrorAlert';
import { PageHeader } from './PageHeader';

/**
 * List screen skeleton: title + page-level actions, an optional toolbar (search/filters the feature owns),
 * the load error, then the content (usually a DataTable, which owns loading/empty/sorting/pagination).
 */
export function ListPageLayout({ title, actions, toolbar, error, children }: {
  title: string; actions?: ReactNode; toolbar?: ReactNode; error?: unknown; children: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} action={actions} />
      <Stack spacing={2}>
        {toolbar}
        <ErrorAlert error={error} />
        {children}
      </Stack>
    </>
  );
}
