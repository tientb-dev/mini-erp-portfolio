import { EntityManager } from 'typeorm';
import { DOCUMENT_MONEY_PRECISION, documentLineMoneySql, nonNegativeDecimal } from '../../common/document-money';
import { BusinessError } from '../workflow/workflow';

export interface PrCommercialHeader {
  name?: string | null;
  requisitionDate?: string | null;
  requiredDate?: string | null;
  description?: string | null;
  currencyId?: number;
  exchangeRateSource?: 'CATALOG' | 'MANUAL';
  exchangeRate?: string;
}

export function assertDecimal(value: string, decimalPlaces: number, code: string) {
  if (!nonNegativeDecimal(value, decimalPlaces)) {
    throw new BusinessError(code, `Enter a non-negative decimal string with up to ${decimalPlaces} decimal places`);
  }
}

export async function savePrCommercialHeader(m: EntityManager, id: number, fields: PrCommercialHeader) {
  const [old] = await m.query('SELECT currency_id, exchange_rate_source FROM purchase_requisitions WHERE id = $1', [id]);
  const currencyChanged = fields.currencyId != null && old.currency_id !== fields.currencyId;
  const source = fields.exchangeRateSource ?? (currencyChanged ? 'CATALOG' : old.exchange_rate_source ?? 'CATALOG');
  if (fields.exchangeRate != null) assertDecimal(fields.exchangeRate, DOCUMENT_MONEY_PRECISION.exchangeRate, 'PR_INVALID_EXCHANGE_RATE');
  if (source === 'CATALOG' && fields.exchangeRate != null) {
    throw new BusinessError('PR_INVALID_EXCHANGE_RATE', 'Send an exchange rate only for manual entry');
  }
  if (!old.currency_id || currencyChanged || source !== old.exchange_rate_source || fields.exchangeRate != null) {
    const [currency] = await m.query(`
      SELECT id, code, decimal_places, exchange_rate
        FROM currencies WHERE (id = $1 OR ($1::int IS NULL AND code = 'VND'))
          AND (is_active OR id = $2) FOR SHARE`,
      [fields.currencyId ?? old.currency_id, old.currency_id]);
    if (!currency) throw new BusinessError('PR_INVALID_CURRENCY', 'Currency not found or inactive');
    const rate = source === 'MANUAL' ? fields.exchangeRate : currency.exchange_rate;
    if (source === 'MANUAL' && (currency.code === 'VND' || !rate || !/[1-9]/.test(rate))) {
      throw new BusinessError('PR_INVALID_EXCHANGE_RATE', 'Manual entry requires a positive foreign exchange rate');
    }
    await m.query(`UPDATE purchase_requisitions SET currency_id = $2, currency_code = $3,
      currency_decimal_places = CASE WHEN currency_id = $2 THEN currency_decimal_places ELSE $4 END,
      exchange_rate = $5, exchange_rate_source = $6 WHERE id = $1`,
      [id, currency.id, currency.code, currency.decimal_places, rate, source]);
  }
  await m.query(`UPDATE purchase_requisitions SET
    name = CASE WHEN $2 THEN $3 ELSE name END,
    requisition_date = CASE WHEN $4 THEN $5 ELSE requisition_date END,
    required_date = CASE WHEN $6 THEN $7 ELSE required_date END,
    description = CASE WHEN $8 THEN $9 ELSE description END WHERE id = $1`,
    [id, fields.name !== undefined, fields.name?.trim() || null,
      fields.requisitionDate !== undefined, fields.requisitionDate ?? null,
      fields.requiredDate !== undefined, fields.requiredDate ?? null,
      fields.description !== undefined, fields.description?.trim() || null]);
}

export const PR_AMOUNTS = documentLineMoneySql({
  quantity: 'l.quantity', unitPrice: 'l.unit_price', taxRate: 'l.tax_rate', decimalPlaces: 'd.currency_decimal_places',
});

export const PR_TOTALS = `
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = count(money.net) THEN sum(money.net) END AS net,
           CASE WHEN count(*) = count(money.tax) THEN sum(money.tax) END AS tax
      FROM purchase_requisition_lines l ${PR_AMOUNTS}
     WHERE l.purchase_requisition_id = d.id
  ) totals ON true
`;

export async function assertPrReady(m: EntityManager, id: number) {
  const [header] = await m.query('SELECT name, sales_contract_id, category, currency_id FROM purchase_requisitions WHERE id = $1', [id]);
  const lines = await m.query(`
    SELECT l.id, l.sales_contract_line_id, l.brand_id, l.supplier_id, l.unit_of_measure_id, l.tax_rate,
           l.unit_price > 0 AS positive_price, money.net, money.tax
      FROM purchase_requisition_lines l JOIN purchase_requisitions d ON d.id = l.purchase_requisition_id
      ${PR_AMOUNTS} WHERE d.id = $1 ORDER BY l.id`, [id]);
  if (!lines.length) throw new BusinessError('PR_LINES_REQUIRED', 'Add at least one valid line before submitting');
  if (!header.name || !header.sales_contract_id || !header.currency_id) {
    throw new BusinessError('PR_HEADER_INCOMPLETE', 'Enter a PR name, sales contract and currency before submitting');
  }
  for (const line of lines) {
    if (header.category === 'SALES_GOODS' && !line.sales_contract_line_id) {
      throw new BusinessError('SALES_CONTRACT_LINE_REQUIRED', 'Every sales-goods PR line must reference a sales contract line');
    }
    if (!line.positive_price || !line.brand_id || !line.supplier_id || !line.unit_of_measure_id || line.tax_rate === null) {
      throw new BusinessError('PR_LINE_INCOMPLETE', `Line ${line.id} requires a brand, supplier, unit, positive price and tax rate`);
    }
    if (line.net === null || line.tax === null) throw new BusinessError('PR_INVALID_TOTAL', `Could not calculate the total for line ${line.id}`);
  }
}
