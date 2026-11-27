import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api-client';
import type { ActivityEntry } from '../../shared/components/ActivityHistoryTable';

export interface Ref { id: number; code: string; name: string }
export interface PersonRef { id: number; employeeCode: string; fullName: string }
export type AccountStatus = 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'NONE';
export interface UserRow {
  id: number; employeeCode: string; fullName: string; email: string | null; phone: string | null; employmentStatus: 'ACTIVE' | 'INACTIVE';
  username: string | null; accountStatus: AccountStatus; version: number; primaryOrgUnit: Ref | null; primaryJobTitle: Ref | null;
}
export interface Membership {
  id?: number; orgUnit: Ref; jobTitle: Ref; isPrimary: boolean; manager: PersonRef | null; isHead?: boolean; startedAt?: string; version?: number;
}
export interface UserDetail extends UserRow {
  accountActive: boolean; mustChangePassword: boolean; lockedUntil: string | null; updatedAt: string;
  roles: (Ref & { isActive: boolean })[]; memberships: Membership[]; warehouses: Ref[];
}

export const USERS = '/admin/users';
export const userKey = (id: number) => [USERS, 'detail', id];
export const useUser = (id: number, enabled = true) => useQuery({ queryKey: userKey(id), queryFn: () => api<UserDetail>(`${USERS}/${id}`), enabled });
export const useUserHistory = (id: number, version: number | undefined, enabled: boolean) => useQuery({
  queryKey: [USERS, 'history', id, version], enabled,
  queryFn: () => api<{ items: ActivityEntry[]; nextCursor: number | null }>(`${USERS}/${id}/history`),
});


export interface OrgNode { id: number; code: string; name: string; parentId: number | null; isActive: boolean; version: number; memberCount?: number }
export const useOrgTree = () => useQuery({ queryKey: ['/admin/org-units', 'tree'], queryFn: () => api<OrgNode[]>('/admin/org-units/tree') });

export const refLabel = (r: { code: string; name: string }) => `${r.code} · ${r.name}`;
export const personLabel = (p: PersonRef) => `${p.employeeCode} · ${p.fullName}`;
