import { useRef, useState } from 'react';
import { Box, IconButton, InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import Calendar from '@mui/icons-material/CalendarTodayOutlined';
import { useTranslation } from 'react-i18next';
import { datePlaceholder, formatDocumentDate, parseDocumentDate } from '../utils/document-date';

type Props = Pick<TextFieldProps, 'label' | 'sx' | 'error' | 'id' | 'size' | 'disabled' | 'fullWidth'> & {
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
  textValue?: string;
  onTextChange?: (text: string) => void;
  localeOverride?: string;
  inputLabel?: string;
};

export function DocumentDatePicker({ value, onChange, onValidityChange, error, textValue, onTextChange, localeOverride, inputLabel, ...props }: Props) {
  const { t, i18n } = useTranslation();
  const locale = localeOverride ?? i18n.language;
  const [draft, setDraft] = useState<{ text: string; value: string; locale: string }>();
  const calendar = useRef<HTMLInputElement>(null);
  const text = textValue ?? (draft?.value === value && draft.locale === locale ? draft.text : formatDocumentDate(value, locale));
  const invalid = Boolean(text && !parseDocumentDate(text, locale));
  function update(text: string) {
    const iso = text === '' ? '' : parseDocumentDate(text, locale);
    onTextChange?.(text);
    setDraft({ text, value: iso ?? value, locale });
    onValidityChange?.(iso !== null);
    if (iso !== null && iso !== value) onChange(iso);
  }
  return <TextField {...props} value={text} error={error || invalid} placeholder={datePlaceholder(locale)}
    onChange={event => update(event.target.value)} slotProps={{
      inputLabel: { shrink: true },
      htmlInput: { inputMode: 'numeric', autoComplete: 'off', maxLength: 10, 'aria-label': inputLabel },
      input: { endAdornment: <InputAdornment position="end">
        <Box sx={{ position: 'relative', display: 'flex' }}>
          <IconButton size="small" disabled={props.disabled} aria-label={t('prPhase.openCalendar')} title={t('prPhase.openCalendar')}
            onClick={() => calendar.current?.showPicker?.()}>
            <Calendar sx={{ fontSize: 16 }} />
          </IconButton>
          <input ref={calendar} type="date" value={value} disabled={props.disabled} tabIndex={-1} aria-hidden="true"
            style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, pointerEvents: 'none' }}
            onChange={event => {
              const iso = event.target.value;
              onTextChange?.(formatDocumentDate(iso, locale));
              setDraft(undefined);
              onValidityChange?.(true);
              onChange(iso);
            }} />
        </Box>
      </InputAdornment> },
    }} />;
}
