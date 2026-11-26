import { ChangeEvent, useRef } from 'react';
import { Box, CircularProgress, IconButton, Tooltip } from '@mui/material';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import { useTranslation } from 'react-i18next';
import { ActionButton, actionIcons } from './ActionButton';
import { GridText } from './GridText';

export function FileAttachmentCell({ name, editable, pending, onChoose, onDownload, onRemove }: {
  name?: string; editable: boolean; pending: boolean; onChoose: (file: File) => void; onDownload: () => void; onRemove: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const Replace = actionIcons.replace;
  const Delete = actionIcons.delete;
  function select(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onChoose(file);
  }
  return <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 0.5, minHeight: 32,
    '& > span': { flexShrink: 0 } }}>
    {editable && <input ref={input} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" hidden onChange={select} />}
    {name ? <>
      <InsertDriveFileOutlined fontSize="small" color="primary" sx={{ flexShrink: 0 }} />
      <GridText value={name} onActivate={onDownload} />
      {editable && <>
        <Tooltip title={t('prDossier.replace')}><span><IconButton size="small" color="primary" disabled={pending}
          aria-label={t('prDossier.replace')} onClick={() => input.current?.click()}><Replace fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title={t('prDossier.remove')}><span><IconButton size="small" color="error" disabled={pending}
          aria-label={t('prDossier.remove')} onClick={onRemove}><Delete fontSize="small" /></IconButton></span></Tooltip>
      </>}
    </> : editable ? <ActionButton action="upload" variant="outlined" size="small" disabled={pending} onClick={() => input.current?.click()}>
      {t('prDossier.upload')}
    </ActionButton> : '—'}
    {pending && <CircularProgress size={14} aria-label={t('common.loading')} sx={{ flexShrink: 0 }} />}
  </Box>;
}
