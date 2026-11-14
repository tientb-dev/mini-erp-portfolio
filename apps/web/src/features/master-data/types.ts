export interface Uom { id: number; code: string; name: string }
export interface Product { id: number; partNumber: string; name: string; unitOfMeasure: Uom; isSerialTracked: boolean; isActive: boolean }
export interface Warehouse { id: number; code: string; name: string; allowAvailableStockIssue: boolean; isActive: boolean }
