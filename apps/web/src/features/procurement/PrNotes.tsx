import { FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api-client';
import { fmtDate } from '../../shared/utils/format';
import type { PrNote } from './types';

export function PrNotes({ id, notes, onSaved }: { id: number; notes: PrNote[]; onSaved: () => void }) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/purchase-requisitions/${id}/notes`, { method: 'POST', body: JSON.stringify({ body }) }),
    onSuccess: () => { setBody(''); onSaved(); },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (body.trim() && !save.isPending) save.mutate();
  };
  return (
    <Stack spacing={2} component="form" onSubmit={submit}>
      {notes.map(note => (
        <div key={note.id}>
          <Typography variant="caption">{note.authorName} · {fmtDate(note.createdAt)}</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note.body}</Typography>
        </div>
      ))}
      {save.error && <Alert severity="error">{save.error.message}</Alert>}
      <TextField label={t('pr.note')} value={body} onChange={e => setBody(e.target.value)} multiline slotProps={{ htmlInput: { maxLength: 4000 } }} />
      <Button type="submit" disabled={!body.trim() || save.isPending} sx={{ alignSelf: 'flex-end' }}>{t('pr.sendNote')}</Button>
    </Stack>
  );
}
