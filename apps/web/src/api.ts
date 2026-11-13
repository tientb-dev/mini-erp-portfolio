// shortcut: hand-written fetch client for the first slice; replace with Orval-generated client (ADR-0001)
// once the API surface grows beyond these few endpoints.
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3100';
const TOKEN_KEY = 'mini-erp-token';

export const token = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t: string) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, detail: string) {
    super(detail);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token.get() ? { Authorization: `Bearer ${token.get()}` } : {}), ...init.headers },
  });
  if (!res.ok) {
    const problem = await res.json().catch(() => ({}));
    if (res.status === 401) token.clear();
    throw new ApiError(res.status, problem.code ?? 'HTTP_ERROR', String(problem.detail ?? res.statusText));
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

export interface Uom { id: number; code: string; name: string }
export interface Product { id: number; partNumber: string; name: string; unitOfMeasure: Uom; isSerialTracked: boolean; isActive: boolean }
export interface Warehouse { id: number; code: string; name: string; allowAvailableStockIssue: boolean; isActive: boolean }
export interface InventoryRow {
  id: number;
  warehouse: { code: string; name: string };
  product: { partNumber: string; name: string; uom: string };
  onHandQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
}
