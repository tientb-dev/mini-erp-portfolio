import { ReactNode, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api-client';

export function DocumentRecordList<T>({ path, items, nextCursor, render }: {
  path: string; items: T[]; nextCursor?: number | null; render: (items: T[]) => ReactNode;
}) {
  const { t } = useTranslation();
  const [older, setOlder] = useState<T[]>([]);
  const [cursor, setCursor] = useState(nextCursor);
  const load = useMutation({
    mutationFn: (before: number) => api<{ items: T[]; nextCursor: number | null }>(`${path}?before=${before}`),
    onSuccess: page => {
      setOlder(previous => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    },
  });
  return (
    <Stack spacing={1}>
      {render([...items, ...older])}
      {load.error && <Alert severity="error">{load.error.message}</Alert>}
      {cursor != null && <Button disabled={load.isPending} onClick={() => load.mutate(cursor)}>{t('common.loadMoreRecords')}</Button>}
    </Stack>
  );
}
