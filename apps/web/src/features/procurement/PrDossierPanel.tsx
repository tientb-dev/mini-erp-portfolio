import { useState } from 'react';
import { Alert, Box, Checkbox, Stack, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import { useTranslation } from 'react-i18next';
import { ActionButton } from '../../shared/components/ActionButton';
import { DocumentEmptyState } from '../../shared/components/DocumentEmptyState';
import { DocumentDatePicker } from '../../shared/components/DocumentDatePicker';
import { ErrorAlert } from '../../shared/components/ErrorAlert';
import { FileAttachmentCell } from '../../shared/components/FileAttachmentCell';
import { FormDialog } from '../../shared/components/FormDialog';
import { GridText } from '../../shared/components/GridText';
import { ScrollTable } from '../../shared/components/ScrollTable';
import { parseDocumentDate } from '../../shared/utils/document-date';
import type { ActionResult } from '../../shared/components/ActionResultDialog';
import type { PrDossierModel, PrDossierRow } from './pr-dossier';

const fields = ['position', 'type', 'hasPaper', 'date', 'issuer', 'note', 'file'] as const;
const widths = [48, 190, 64, 160, 150, undefined, '24%'];

export function PrDossierPanel({ model, saving, onSave, onResult, templateConflict, onTemplateResolved }: {
  model: PrDossierModel; saving: boolean; onSave?: () => void; onResult: (result: ActionResult) => void;
  templateConflict?: boolean; onTemplateResolved?: () => void;
}) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState<{ row: PrDossierRow; file?: File }>();
  const [removedByConfig, setRemovedByConfig] = useState(false);
  const [confirmConfigRemoval, setConfirmConfigRemoval] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const manage = model.canManage;
  const countPaper = model.rows.filter(row => model.values(row).hasPaper).length;
  const countFiles = model.rows.filter(row => model.values(row).file).length;
  const failure = (action: string, error: unknown) => onResult({ success: false, error, message: t(`prDossier.${action}Failed`) });
  const refreshTemplate = async (discardRemoved = false) => {
    setRefreshing(true);
    try {
      if (await model.refreshTemplate(discardRemoved)) { setRemovedByConfig(false); onTemplateResolved?.(); }
      else setRemovedByConfig(true);
    } catch (error) { failure('refresh', error); }
    finally { setRefreshing(false); }
  };
  const upload = (row: PrDossierRow, file: File) => {
    void model.upload(row, file).catch(error => failure('upload', error));
  };
  const currentFile = confirmation && model.values(confirmation.row).file;
  return <Stack spacing={1.25}>
    <ErrorAlert error={model.error} />
    {templateConflict && <Alert severity="warning" action={<ActionButton action="refresh" size="small"
      disabled={refreshing || model.pending || saving} onClick={() => removedByConfig ? setConfirmConfigRemoval(true) : void refreshTemplate()}>
      {t(removedByConfig ? 'prDossier.discardRemoved' : 'prDossier.refresh')}</ActionButton>}>
      {t(removedByConfig ? 'prDossier.typesRemoved' : 'prDossier.templateChanged')}
    </Alert>}
    {model.loading ? <Typography variant="body2">{t('common.loading')}</Typography>
      : !model.error && !model.rows.length ? <DocumentEmptyState icon={<FolderOutlined fontSize="small" />} label={t('pr.noDossier')} />
      : model.rows.length > 0 && <>
        {onSave && manage && <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontWeight: 700 }}>{t('prDossier.title')}</Typography>
          <ActionButton action="save" variant="outlined" onClick={onSave} disabled={!model.dirty || model.pending || model.invalid || saving}>
            {t('prDossier.save')}
          </ActionButton>
        </Stack>}
        <ScrollTable label={t('prDossier.title')} columnWidths={widths} minWidth={980} maxHeight="min(46vh, 450px)">
          <TableHead sx={{ position: 'sticky', top: 0, zIndex: 2, '& th': { position: 'static', bgcolor: 'background.default', py: 0.75 } }}>
            <TableRow>
              <TableCell colSpan={2} />
              <TableCell align="center" scope="colgroup" colSpan={4}>{t('prDossier.paper')}</TableCell>
              <TableCell align="center" scope="colgroup">{t('prDossier.electronic')}</TableCell>
            </TableRow>
            <TableRow>{fields.map(field => <TableCell key={field} scope="col" align={field === 'hasPaper' ? 'center' : undefined}
              sx={field === 'position' ? { px: 1 } : undefined}>
              <GridText value={t(`prDossier.${field}`)} />
            </TableCell>)}</TableRow>
          </TableHead>
          <TableBody>{model.rows.map((row, index) => {
            const value = model.values(row);
            const disabled = !value.hasPaper || saving;
            const field = (key: 'issuer' | 'note', maxLength: number) => manage
              ? <TextField size="small" fullWidth disabled={disabled} value={value[key]}
                onChange={event => model.update(row, { [key]: event.target.value })}
                slotProps={{ htmlInput: { 'aria-label': `${t(`prDossier.${key}`)} · ${row.name}`, maxLength,
                  title: value[key] || undefined } }}
                sx={{ '& input': { textOverflow: 'ellipsis' } }} />
              : <GridText value={value[key] || '—'} />;
            return <TableRow key={row.dossierTypeId}>
              <TableCell sx={{ px: 1 }}>{index + 1}</TableCell>
              <TableCell><GridText value={row.name} /></TableCell>
              <TableCell align="center"><Checkbox size="small" disabled={!manage || saving} checked={value.hasPaper}
                slotProps={{ input: { 'aria-label': `${t('prDossier.hasPaper')} · ${row.name}` } }}
                onChange={event => model.update(row, { hasPaper: event.target.checked })} /></TableCell>
              <TableCell>{manage ? <DocumentDatePicker disabled={disabled} size="small" fullWidth localeOverride="vi"
                textValue={value.date} value={parseDocumentDate(value.date, 'vi') ?? ''}
                sx={{ '& .MuiOutlinedInput-root': { pr: 0.5 }, '& .MuiInputBase-input': { px: 1 } }}
                inputLabel={`${t('prDossier.date')} · ${row.name}`} onChange={() => undefined}
                onTextChange={date => model.update(row, { date })} /> : <GridText value={value.date || '—'} />}</TableCell>
              <TableCell>{field('issuer', 300)}</TableCell>
              <TableCell>{field('note', 4000)}</TableCell>
              <TableCell><FileAttachmentCell name={value.file?.name} editable={manage && !saving}
                pending={model.working.has(row.dossierTypeId)}
                onChoose={file => value.file ? setConfirmation({ row, file }) : upload(row, file)}
                onDownload={() => { if (value.file) void model.download(value.file).catch(error => failure('download', error)); }}
                onRemove={() => setConfirmation({ row })} /></TableCell>
            </TableRow>;
          })}</TableBody>
        </ScrollTable>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, justifyContent: 'space-between' }}>
          <Typography variant="body2" color="text.secondary">{t('prDossier.totals', { types: model.rows.length, papers: countPaper, files: countFiles })}</Typography>
          {model.dirty && <Typography variant="body2" color="warning.dark">{t('prDossier.dirty')}</Typography>}
        </Stack>
      </>}
    {confirmation && currentFile && <FormDialog title={t(confirmation.file ? 'prDossier.replace' : 'prDossier.remove')}
      submitLabel={t(confirmation.file ? 'prDossier.replaceAction' : 'prDossier.removeAction')}
      submitAction={confirmation.file ? 'replace' : 'delete'} pageGuardsNavigation canSubmit pending={false} error={null}
      onSubmit={() => {
        if (confirmation.file) upload(confirmation.row, confirmation.file);
        else model.update(confirmation.row, { file: null });
        setConfirmation(undefined);
      }} onClose={() => setConfirmation(undefined)}>
      <Typography sx={{ overflowWrap: 'anywhere' }}>{t(confirmation.file ? 'prDossier.replaceHint' : 'prDossier.removeHint',
        { type: confirmation.row.name, current: currentFile.name })}</Typography>
      {confirmation.file && <Stack spacing={0.5}>
        {([['currentFile', currentFile.name], ['replacementFile', confirmation.file.name]] as const).map(([label, name], index) =>
          <Stack key={label} spacing={0.5}>
            {index === 1 && <ArrowDownward aria-hidden sx={{ alignSelf: 'center', color: 'text.secondary' }} />}
            <Stack direction="row" spacing={1} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.25 }}>
              <InsertDriveFileOutlined aria-hidden color="primary" sx={{ flexShrink: 0 }} />
              <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t(`prDossier.${label}`)}</Typography>
                <Typography variant="body2">{name}</Typography>
              </Box>
            </Stack>
          </Stack>)}
      </Stack>}
      <Typography color="text.secondary">{t(confirmation.file ? 'prDossier.replaceRetention' : 'prDossier.onSave')}</Typography>
    </FormDialog>}
    {confirmConfigRemoval && <FormDialog title={t('prDossier.discardRemoved')} submitLabel={t('prDossier.discardRemoved')}
      submitAction="delete" pageGuardsNavigation canSubmit pending={refreshing} error={null}
      onClose={() => setConfirmConfigRemoval(false)} onSubmit={() => { setConfirmConfigRemoval(false); void refreshTemplate(true); }}>
      {t('prDossier.typesRemoved')}
    </FormDialog>}
  </Stack>;
}
