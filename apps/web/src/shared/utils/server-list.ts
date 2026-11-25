import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../services/api-client';

export interface ListPage<R> { items: R[]; total: number }
export function useDebouncedText(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

export function useServerList<R>(path: string, params: URLSearchParams, enabled = true) {
  return useQuery({
    queryKey: [path, params.toString()],
    queryFn: ({ signal }) => api<ListPage<R>>(path + '?' + params, { signal }),
    enabled,
    placeholderData: previous => previous,
  });
}
