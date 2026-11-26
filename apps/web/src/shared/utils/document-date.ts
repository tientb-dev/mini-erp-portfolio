export function datePlaceholder(locale: string) {
  return locale.startsWith('vi') ? 'dd/mm/yyyy' : 'mm/dd/yyyy';
}

export function formatDocumentDate(value: string, locale: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return '';
  const [, year, month, day] = match;
  return (locale.startsWith('vi') ? [day, month, year] : [month, day, year]).join('/');
}

export function parseDocumentDate(value: string, locale: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, first, second, year] = match;
  const [day, month] = locale.startsWith('vi') ? [first, second] : [second, first];
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y && d >= 1 && d <= (days[m - 1] ?? 0) ? [year, month, day].join('-') : null;
}
