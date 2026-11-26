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
  constructor(readonly status: number, readonly code: string, detail: string, readonly fieldIssue?: { index: number; field: string }) {
    super(detail);
  }
}

export async function apiResponse(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const accessToken = token.get();
  if (accessToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${accessToken}`);
  if (!(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const problem = await res.json().catch(() => ({}));
    if (res.status === 401) token.clear();
    throw new ApiError(res.status, problem.code ?? 'HTTP_ERROR', String(problem.detail ?? res.statusText), problem.fieldIssue);
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiResponse(path, init);
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

// Active options plus the one stored value needed when editing an existing record.
export function catalogSelectionPath(path: string, existingId?: unknown) {
  return path + '?activeOnly=true' + (typeof existingId === 'number' && Number.isSafeInteger(existingId) && existingId > 0 ? '&includeId=' + existingId : '');
}
