import { expect, it } from 'vitest';
import { decimalFromMinor, previewDocumentLine } from './document-money';

it('rounds the subtotal before tax using DEC-19-07', () => {
  expect(previewDocumentLine('1.25', '0.4000', '50.00', 0)).toEqual({ net: 1n, tax: 1n, total: 2n });
  expect(previewDocumentLine('1', '3.505', '10', 2)).toEqual({ net: 351n, tax: 35n, total: 386n });
  expect(previewDocumentLine('0.0001', '1', '0', 0)).toBeNull();
  expect(previewDocumentLine('1', '1.00001', '0', 0)).toBeNull();
  expect(previewDocumentLine('2', '12', '', 0)).toEqual({ net: 24n, tax: null, total: null });
  expect(decimalFromMinor(386n, 2)).toBe('3.86');
});
