/** DEC-19-07 limits for new document values. */
export const DOCUMENT_MONEY_PRECISION = { quantity: 3, unitPrice: 4, exchangeRate: 8, taxRate: 2 } as const;

export function nonNegativeDecimal(value: unknown, decimalPlaces: number): value is string {
  return typeof value === 'string' && value.length <= 1000
    && new RegExp(`^\\d+(?:\\.\\d{1,${decimalPlaces}})?$`).test(value);
}

/**
 * SQL for trusted column expressions. PostgreSQL round(numeric, int) implements HALF_UP
 * on exact decimals. Tax is computed from the rounded subtotal.
 */
export function documentLineMoneySql(columns: { quantity: string; unitPrice: string; taxRate: string; decimalPlaces: string }) {
  const { quantity, unitPrice, taxRate, decimalPlaces } = columns;
  return `
    CROSS JOIN LATERAL (SELECT round(${quantity} * ${unitPrice}, ${decimalPlaces}) AS net) subtotal
    CROSS JOIN LATERAL (SELECT subtotal.net,
      round(subtotal.net * ${taxRate} * 0.01, ${decimalPlaces}) AS tax) money
  `;
}
