import { pagePath } from '../../shared/navigation';

export interface ScRow {
  id: number; documentNumber: string; status: string; version: number; customerId: number; customerName: string; createdByName: string; createdAt: string;
  pendingProposals: number; lineCount: number; responsibleSalesUserId: number | null; responsibleSalesName: string | null;
}
export interface Proposal {
  id: number; productId: number; partNumber: string; name: string; status: string; reason: string; decisionNote: string | null;
  proposedByName: string; decidedByName: string | null; decidedAt: string | null;
}
/** UoM comes from the catalog relation (`uomName`/`uomCode` = units_of_measure name/code). */
export interface ScLine {
  productId?: number | null;
  temporaryProductId?: number | null;
  itemDescription?: string | null; id: number; itemCode: string; itemName: string; unitOfMeasureId: number; uomName: string; uomCode: string; quantity: string; products: Proposal[] }
export interface ScDetail extends Omit<ScRow, 'lineCount'> {
  customerCode: string; createdBy: number; lines: ScLine[]; updatedAt: string | null; updatedByName: string | null;
}

export const SC_LIST = pagePath('salesContracts');
// The list keeps its search/filter/sort/page in the URL; Back from a detail returns to the last one seen.
let lastListSearch = '';
export const rememberListSearch = (search: string) => { lastListSearch = search; };
export const listUrl = () => `${SC_LIST}${lastListSearch}`;
