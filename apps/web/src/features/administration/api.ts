import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api-client';

export interface CatalogPermission { code: string; module: string; name: string; description: string | null; adminOnly: boolean }
export interface RoleUser { id: number; username: string; fullName: string; isActive: boolean }
export interface RoleRow {
  id: number; code: string; name: string; description: string | null; isActive: boolean; isSystem: boolean; userCount: number; permissionCount: number;
}
export interface RoleHistoryEntry {
  id: number; action: string; createdAt: string; actorName: string; metadata: Record<string, unknown> | null;
}
export interface RoleDetail {
  id: number; code: string; name: string; description: string | null; isActive: boolean; isSystem: boolean; version: number;
  permissions: string[]; users: RoleUser[]; history: RoleHistoryEntry[]; historyCursor: number | null;
}

export const roleKey = (id: number) => ['admin-role', id];
export const usePermissionCatalog = () => useQuery({ queryKey: ['admin-permissions'], queryFn: () => api<CatalogPermission[]>('/admin/permissions'), staleTime: Infinity });
export const useRole = (id: number, enabled = true) => useQuery({ queryKey: roleKey(id), queryFn: () => api<RoleDetail>(`/admin/roles/${id}`), enabled });
