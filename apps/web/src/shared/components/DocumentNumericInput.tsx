import { useRef, useState } from 'react';
import { TextField, type TextFieldProps } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { trimDecimal } from '../utils/format';

function separators(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(1000.1);
  return { group: parts.find(part => part.type === 'group')?.value ?? ',',
    decimal: parts.find(part => part.type === 'decimal')?.value ?? '.' };
}

export function parseDocumentNumber(text: string, locale: string) {
  const { group, decimal } = separators(locale);
  const [whole, fraction, ...rest] = text.trim().split(decimal);
  if (rest.length) return text;
  const groups = whole.split(group);
  const grouped = groups.length > 1 && /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every(part => /^\d{3}$/.test(part));
  if (groups.length > 1 && !grouped && fraction !== undefined) return text;
  const integer = grouped ? groups.join('') : whole;
  return fraction === undefined ? integer : integer + '.' + fraction;
}

export function displayDocumentNumber(value: string, locale: string, precision: number, grouped: boolean) {
  if (!/^\d+(\.\d*)?$/.test(value)) return value.trimEnd();
  const [, originalFraction = ''] = value.split('.');
  const display = originalFraction.length > precision ? value : trimDecimal(value);
  const [whole, fraction] = display.split('.');
  const { decimal } = separators(locale);
  const integer = grouped ? new Intl.NumberFormat(locale).format(BigInt(whole)) : whole;
  return integer + (fraction === undefined ? '' : decimal + fraction);
}

type Props = Pick<TextFieldProps, 'id' | 'label' | 'sx' | 'error'> & {
  value: string; precision: number; onChange: (value: string) => void; readOnly?: boolean; inputLabel?: string; alignRight?: boolean;
};

export function DocumentNumericInput({ value, precision, onChange, readOnly, inputLabel, alignRight, ...props }: Props) {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const [draft, setDraft] = useState<{ text: string; value: string }>();
  const input = useRef<HTMLInputElement>(null);
  const formatted = displayDocumentNumber(value, locale, precision, true);
  return <TextField {...props} inputRef={input} value={draft?.value === value ? draft.text : formatted}
    onFocus={event => {
      if (readOnly) return;
      const element = event.target;
      const { group } = separators(locale);
      const position = (index: number) => formatted.slice(0, index).split(group).join('').length;
      const start = position(element.selectionStart ?? 0), end = position(element.selectionEnd ?? 0);
      const text = displayDocumentNumber(value, locale, precision, false);
      setDraft({ text, value });
      requestAnimationFrame(() => {
        if (document.activeElement === input.current) input.current?.setSelectionRange(start, end);
      });
    }}
    onBlur={() => setDraft(undefined)} onChange={event => {
      const text = event.target.value;
      const canonical = parseDocumentNumber(text, locale);
      setDraft({ text, value: canonical });
      onChange(canonical);
    }} slotProps={{
      input: { readOnly },
      htmlInput: { inputMode: 'decimal', 'aria-label': inputLabel, style: alignRight ? { textAlign: 'right' } : undefined },
    }} />;
}
