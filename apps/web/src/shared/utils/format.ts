/** `dd/MM/yyyy, HH:mm` in every language. */
export const fmtDate = (v: string) => new Date(v).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
export const num = (v: string | number) => Number(v);
/** `dd/MM/yyyy` in every language (the list shows the day; the full time goes in a tooltip). */
export const fmtDay = (v: string) => new Date(v).toLocaleDateString('en-GB');
