import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import { wrap } from '../../test/helpers/api';
import { formatDocumentDate, parseDocumentDate } from '../utils/document-date';
import { DocumentDatePicker } from './DocumentDatePicker';
import { DocumentNumericInput, displayDocumentNumber, parseDocumentNumber } from './DocumentNumericInput';

it('round-trips Vietnamese dates as calendar dates and rejects invalid dates', () => {
  expect(formatDocumentDate('2026-11-26', 'vi')).toBe('26/11/2026');
  expect(parseDocumentDate('26/11/2026', 'vi')).toBe('2026-11-26');
  expect(parseDocumentDate('11/26/2026', 'en')).toBe('2026-11-26');
  expect(parseDocumentDate('29/02/2024', 'vi')).toBe('2024-02-29');
  expect(parseDocumentDate('29/02/2026', 'vi')).toBeNull();
  expect(parseDocumentDate('31/04/2026', 'vi')).toBeNull();
});

it('shows the localized date and sends ISO only after a valid edit', () => {
  const dates: string[] = [];
  function Field() {
    const [value, setValue] = useState('2026-11-26');
    return <DocumentDatePicker label="Date" value={value} onChange={date => { setValue(date); dates.push(date); }} />;
  }
  wrap(<Field />);
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Date' });
  expect(input.placeholder).toBe('dd/mm/yyyy');
  expect(input.value).toBe('26/11/2026');
  fireEvent.change(input, { target: { value: '31/02/2026' } });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(dates).toEqual([]);
  fireEvent.change(input, { target: { value: '28/02/2026' } });
  expect(dates).toEqual(['2026-02-28']);
  fireEvent.change(input, { target: { value: '' } });
  expect(dates).toEqual(['2026-02-28', '']);
});

it('groups decimal strings exactly and keeps over-precision visible', () => {
  expect(displayDocumentNumber('1000000.0000', 'vi', 4, true)).toBe('1.000.000');
  expect(displayDocumentNumber('999999999999999.123', 'vi', 3, true)).toBe('999.999.999.999.999,123');
  expect(displayDocumentNumber('1.123450', 'vi', 4, true)).toBe('1,123450');
  expect(parseDocumentNumber('1.000.000,12345', 'vi')).toBe('1000000.12345');
  expect(parseDocumentNumber('1,000,000.12345', 'en')).toBe('1000000.12345');
  expect(parseDocumentNumber('12.34,5', 'vi')).toBe('12.34,5');
});

it('preserves the numeric edit on focus, paste, blur and clear', () => {
  const changes: string[] = [];
  function Field() {
    const [value, setValue] = useState('1000000');
    return <DocumentNumericInput label="Amount" value={value} precision={4}
      onChange={value => { setValue(value); changes.push(value); }} />;
  }
  wrap(<Field />);
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Amount' });
  expect(input.value).toBe('1.000.000');
  fireEvent.focus(input);
  expect(input.value).toBe('1000000');
  fireEvent.change(input, { target: { value: '1.000.000,12345' } });
  fireEvent.blur(input);
  expect(input.value).toBe('1.000.000,12345');
  expect(changes).toEqual(['1000000.12345']);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '' } });
  expect(changes.at(-1)).toBe('');
});
