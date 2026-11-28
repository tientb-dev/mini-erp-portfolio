import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api-client';

export interface OwnerOrgUnit { id: number; code: string; name: string; isPrimary: boolean }

export interface Me { id: number; username?: string; fullName?: string; mustChangePassword?: boolean; roleCodes?: string[]; permissions: string[]; warehouseIds: number[]; ownerOrgUnits?: OwnerOrgUnit[] }

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
