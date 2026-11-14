import type { HistoryEntry } from '../workflow';


export interface GirRow {
  id: number; documentNumber: string; issueType: string; approvalStatus: string; approvalStep: number | null; executionStatus: string;
  salesContractNumber: string; warehouseCode: string; createdByName: string; assignedApproverName: string | null; createdAt: string;
}
export interface PrLineOption {
  id: number; purchaseRequisitionId: number; prNumber: string; category: string; partNumber: string; productName: string; uom: string;
  quantity: string; receivedQuantity: string; remainingQuantity: number;
}
export interface GirLine {
  /** A/C only, reference (03 §3a): first approved GR of the PR line and the quantity received for it. */
  firstGoodsReceipt?: { goodsReceiptId: number; documentNumber: string; warehouseCode: string } | null; receivedQuantity?: number | null;
  id: number; prNumber: string | null; salesContractLineId: number | null; contractItem: string; contractQuantity: string; productId: number; partNumber: string;
  productName: string; isSerialTracked: boolean; uom: string; quantity: string; productConfirmed: boolean; issuedQuantity: string; committedQuantity: string;
}
export interface StockSource {
  sourceSalesContractId: number; sourceSalesContractNumber: string; sourceOwnerUserId: number; sourceOwnerName: string;
  productId: number; partNumber: string; productName: string; available: number;
}
export interface GirDetail extends GirRow {
  category: string; version: number; sourceSalesContractNumber: string | null; sourceOwnerName: string | null; purpose: string | null; warehouseId: number; salesContractId: number; createdBy: number; assignedApproverId: number | null;
  warehouseApproverName: string | null; completionReason: string | null;
  lines: GirLine[]; goodsIssues: { id: number; documentNumber: string; approvalStatus: string }[]; history: HistoryEntry[];
}
export interface GiRow { id: number; documentNumber: string; approvalStatus: string; girNumber: string; warehouseCode: string; createdByName: string; assignedApproverName: string | null; createdAt: string }
export interface GiDetail extends GiRow {
  version: number; goodsIssueRequestId: number; girExecutionStatus: string; createdBy: number; assignedApproverId: number | null;
  lines: { id: number; goodsIssueRequestLineId: number; partNumber: string; productName: string; isSerialTracked: boolean; uom: string; quantity: string; serials: { goodsReceiptDetailId: number; serialNumber: string }[] }[];
  history: HistoryEntry[];
}
export interface ScLine { id: number; itemName: string; quantity: string; products: { productId: number; partNumber: string; name: string; status: string }[] }
