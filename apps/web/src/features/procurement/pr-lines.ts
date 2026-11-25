import type { DocLine } from './types';
import type { PickerProduct } from '../../shared/components/ProductPicker';
import { trimDecimal } from '../../shared/utils/format';

export interface ContractLine {
  id: number; itemCode: string; itemName: string; itemDescription?: string; quantity: string;
  productId?: number | null; temporaryProductId?: number | null;
}
export interface PrLine {
  key: string; id?: number; productId?: number | null; temporaryProductId?: number | null;
  partNumber: string; productName: string; requirementDescription: string;
  brandId?: number | null; brandName?: string; supplierId?: number | null; supplierName?: string;
  unitOfMeasureId?: number | null; uom: string; quantity: string; unitPrice: string;
  taxRateId?: number | null; taxRate: string; salesContractLineId?: number | null; ref: string;
  subtotal?: string | null; taxAmount?: string | null; total?: string | null;
}
type CommercialLine = Omit<PrLine, 'key' | 'id'>;
export function fromSavedPrLine(line: DocLine): PrLine {
  const saved: Partial<CommercialLine> = line;
  return { ...saved, key: 'saved:' + line.id, id: line.id, partNumber: line.partNumber, productName: line.productName,
    requirementDescription: saved.requirementDescription ?? '', uom: line.uom ?? '', quantity: trimDecimal(line.quantity),
    unitPrice: trimDecimal(saved.unitPrice ?? '0'), taxRate: trimDecimal(saved.taxRate ?? ''),
    salesContractLineId: saved.salesContractLineId ?? line.sourceLineId, ref: line.ref ?? '' };
}
export function fromPickedProduct(item: PickerProduct, contract: ContractLine[]): PrLine {
  const matches = contract.filter(line => (item.source === 'main' ? line.productId : line.temporaryProductId) === item.id);
  return { key: crypto.randomUUID(), [item.source === 'main' ? 'productId' : 'temporaryProductId']: item.id,
    partNumber: item.code, productName: item.name, requirementDescription: item.description ?? '',
    brandId: item.brandId, brandName: item.brand, unitOfMeasureId: item.unitOfMeasureId, uom: item.uom ?? '',
    quantity: '1', unitPrice: '0', taxRate: '', salesContractLineId: matches.length === 1 ? matches[0].id : null,
    ref: matches.length === 1 ? matches[0].itemName : '' };
}
export const decimalInput = (value: string, places: number) => new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(value);
export const positiveDecimal = (value: string) => /[1-9]/.test(value);
export function prLineErrors(line: PrLine, submit: boolean, salesGoods: boolean) {
  const values: Partial<Record<keyof PrLine, string>> = {};
  if (submit && !line.brandId) values.brandId = 'required';
  if (submit && !line.supplierId) values.supplierId = 'required';
  if (submit && !line.unitOfMeasureId) values.unitOfMeasureId = 'required';
  if (!decimalInput(line.quantity, 3) || !positiveDecimal(line.quantity) || line.quantity.split('.')[0].replace(/^0+/, '').length > 15) values.quantity = 'badQuantity';
  if (!decimalInput(line.unitPrice, 4) || line.unitPrice.length > 1000 || (submit && !positiveDecimal(line.unitPrice))) values.unitPrice = submit ? 'positivePrice' : 'badPrice';
  if (submit && !line.taxRateId) values.taxRateId = 'required';
  if (submit && salesGoods && !line.salesContractLineId) values.salesContractLineId = 'required';
  return values;
}
