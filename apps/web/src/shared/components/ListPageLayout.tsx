import { ReactNode } from 'react';
import { Stack } from '@mui/material';
import { fillMedia } from '../../config/theme';
import { ErrorAlert } from './ErrorAlert';
import { PageHeader } from './PageHeader';

/**
 * List screen skeleton: title + page-level actions, an optional toolbar (search/filters the feature owns),
 * the load error, then the content (usually a DataTable, which owns loading/empty/sorting/pagination).
 * `fill`: on fill screens (fillMedia) the page holds the main area's height and the table (DataTable fill) scrolls
 * inside, so title and filters stay put.
 */
export function ListPageLayout({ title, actions, toolbar, error, breadcrumbs, fill, children }: {
  title: string; actions?: ReactNode; toolbar?: ReactNode; error?: unknown; breadcrumbs?: ReactNode; fill?: boolean; children: ReactNode;
}) {
  const fillSx = fill ? { [fillMedia]: { flex: '1 1 0', minHeight: 0 } } : {};
  return (
    <Stack data-fill-page={fill ? '' : undefined} sx={{ ...fillSx, minWidth: 0 }}>
      <PageHeader title={title} action={actions} breadcrumbs={breadcrumbs} />
      <Stack spacing={2} sx={fill ? { [fillMedia]: { flex: '1 1 0', minHeight: 0, '& > :not([data-fill-grow])': { flexShrink: 0 } } } : undefined}>
        {toolbar}
        <ErrorAlert error={error} />
        {children}
      </Stack>
    </Stack>
  );
}
