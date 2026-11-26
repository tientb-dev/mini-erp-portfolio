import type { TFunction } from 'i18next';

export interface Entry {
  id: number;
  code?: string;
  partNumber?: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  isSerialTracked?: boolean;
  isUsed?: boolean;
  isStockUsed?: boolean;
  allowAvailableStockIssue?: boolean;
  unitOfMeasureId?: number;
  brandId?: number;
  exchangeRate?: string;
  decimalPlaces?: number;
  rate?: string;
}

export type FieldKey = Exclude<keyof Entry, 'id' | 'isUsed' | 'isStockUsed'>;
export interface Catalog {
  key: string;
  path: string;
  create: string;
  update: string;
  fullPage?: boolean;
  fields: FieldKey[];
  columns?: FieldKey[];
}

const manage = 'PROCUREMENT_CATALOG.MANAGE';
export const catalogs = {
  products: { key: 'products', path: 'products', create: 'PRODUCT.CREATE', update: 'PRODUCT.UPDATE', fullPage: true,
    fields: ['partNumber', 'name', 'brandId', 'unitOfMeasureId', 'isSerialTracked', 'description'],
    columns: ['brandId', 'unitOfMeasureId', 'isSerialTracked'] },
  temporaryProducts: { key: 'temporaryProducts', path: 'temporary-products', create: manage, update: manage,
    fields: ['code', 'name', 'description'] },
  brands: { key: 'brands', path: 'brands', create: manage, update: manage, fullPage: true, fields: ['code', 'name', 'description'] },
  unitsOfMeasure: { key: 'unitsOfMeasure', path: 'units-of-measure', create: 'UOM.MANAGE', update: 'UOM.MANAGE', fields: ['code', 'name', 'description'] },
  warehouses: { key: 'warehouses', path: 'warehouses', create: 'WAREHOUSE.CREATE', update: 'WAREHOUSE.UPDATE',
    fields: ['code', 'name', 'allowAvailableStockIssue', 'description'], columns: ['allowAvailableStockIssue'] },
  customers: { key: 'customers', path: 'customers', create: 'CUSTOMER.CREATE', update: 'CUSTOMER.UPDATE', fields: ['code', 'name', 'description'] },
  suppliers: { key: 'suppliers', path: 'suppliers', create: 'SUPPLIER.CREATE', update: 'SUPPLIER.UPDATE', fields: ['code', 'name', 'description'] },
  currencies: { key: 'currencies', path: 'currencies', create: manage, update: manage,
    fields: ['code', 'name', 'exchangeRate', 'decimalPlaces', 'description'], columns: ['exchangeRate', 'decimalPlaces'] },
  taxRates: { key: 'taxRates', path: 'tax-rates', create: manage, update: manage,
    fields: ['code', 'name', 'rate', 'description'], columns: ['rate'] },
  dossierTypes: { key: 'dossierTypes', path: 'dossier-types', create: 'DOSSIER_TYPE.MANAGE', update: 'DOSSIER_TYPE.MANAGE',
    fields: ['code', 'name', 'description'] },
} satisfies Record<string, Catalog>;

export const label = (t: TFunction, field: FieldKey) => t(`master.fields.${field}`);
export const entryCode = (entry: Entry) => entry.partNumber ?? entry.code ?? '';
export const statusLabel = (t: TFunction, active: boolean) => t(active ? 'master.active' : 'master.inactive');

export function displayDecimal(value: string, locale: string) {
  const [integer, fraction = ''] = value.split('.');
  const format = new Intl.NumberFormat(locale);
  const digits = fraction.replace(/0+$/, '');
  return format.format(Number(integer)) + (digits ? (format.formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.') + digits : '');
}
