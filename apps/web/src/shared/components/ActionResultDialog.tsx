import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material';
import Check from '@mui/icons-material/Check';
import Close from '@mui/icons-material/Close';
import Schedule from '@mui/icons-material/Schedule';

export type ActionResult = ({ success: true } | { success: false; error: unknown }) & { title?: string; message?: string; status?: string; hint?: string };

export function ActionResultDialog({ result, onClose }: { result: ActionResult; onClose: () => void }) {
  const { t } = useTranslation();
  const failure = result.success ? undefined : result.error as { code?: string; message?: string } | undefined;
  const detail = failure?.code ? t(`errors.${failure.code}`, { defaultValue: failure.message }) : failure?.message;
  useEffect(() => {
    if (!result.success) return;
    const timer = window.setTimeout(onClose, 3000);
    return () => window.clearTimeout(timer);
  }, [result, onClose]);
  return (
    <Dialog open maxWidth={false} fullWidth aria-labelledby="action-result-title" onClose={result.success ? onClose : undefined}
      slotProps={{ paper: { sx: { width: 460, minHeight: 260, borderRadius: 3 } } }}>
      <DialogContent sx={{ display: 'grid', placeItems: 'center' }}>
        <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', overflowWrap: 'anywhere' }}>
          <Box aria-hidden sx={{ width: 64, height: 64, borderRadius: '50%', display: 'grid', placeItems: 'center',
            color: 'common.white', bgcolor: result.success ? 'success.main' : 'error.main', '& svg': { fontSize: 38 } }}>
            {result.success ? <Check /> : <Close />}
          </Box>
          <Typography id="action-result-title" variant="h2" sx={{ fontSize: '1.25rem' }}>
            {result.title ?? t(result.success ? 'common.actionSucceeded' : 'common.actionFailed')}
          </Typography>
          {result.message && <Typography>{result.message}</Typography>}
          {result.status && <Typography color="text.secondary">{result.status}</Typography>}
          {detail && <Typography role="alert" color="text.secondary">{detail}</Typography>}
          {result.hint && <Typography color="text.secondary">{result.hint}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ minHeight: 52, justifyContent: result.success ? 'center' : 'flex-end' }}>
        {result.success ? <Stack direction="row" spacing={0.75} sx={{ color: 'text.secondary', alignItems: 'center' }}>
          <Schedule sx={{ fontSize: 16 }} /><Typography variant="body2">{t('common.resultAutoClose')}</Typography>
        </Stack> : <Button onClick={onClose} variant="contained">{t('common.understood')}</Button>}
      </DialogActions>
    </Dialog>
  );
}
