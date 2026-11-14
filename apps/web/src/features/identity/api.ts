import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api-client';

export interface Me { id: number; permissions: string[]; warehouseIds: number[] }

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
