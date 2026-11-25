export interface DocumentAmounts { net: bigint; tax: bigint | null; total: bigint | null }
const power = (scale: number) => BigInt(10) ** BigInt(scale);
function parse(value: string, places: number) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2]?.length ?? 0) > places) return null;
  return BigInt(match[1] + (match[2] ?? '').padEnd(places, '0'));
}
const round = (value: bigint, divisor: bigint) => (value + divisor / BigInt(2)) / divisor;

export function previewDocumentLine(quantity: string, price: string, taxRate: string, scale: number): DocumentAmounts | null {
  const qty = parse(quantity, 3), unit = parse(price, 4), rate = parse(taxRate, 2);
  if (qty === null || unit === null) return null;
  const net = scale <= 7 ? round(qty * unit, power(7 - scale)) : qty * unit * power(scale - 7);
  const tax = rate === null ? null : round(net * rate, power(4));
  return { net, tax, total: tax === null ? null : net + tax };
}

export function decimalFromMinor(value: bigint, scale: number) {
  const digits = value.toString().padStart(scale + 1, '0');
  return scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits;
}

export function formatDocumentAmount(value: unknown, scale: number, locale: string) {
  if (value == null) return '—';
  const [whole, fraction = ''] = String(value).split('.');
  const fmt = new Intl.NumberFormat(locale);
  const separator = fmt.formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
  return fmt.format(BigInt(whole)) + (scale ? separator + fraction.padEnd(scale, '0') : '');
}
