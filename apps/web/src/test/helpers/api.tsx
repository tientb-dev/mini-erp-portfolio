import { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

/** Renders inside a fresh QueryClient and a router at `url` (pages read route params and links). */
export const wrap = (ui: ReactNode, url = '/') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
  </QueryClientProvider>,
);

/** Routes fetch calls by path to canned JSON (longest matching prefix wins); records POST/PATCH/DELETE bodies. */
export function mockApi(routes: Record<string, unknown>) {
  const posts: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    if (init?.method === 'POST' || init?.method === 'PATCH' || init?.method === 'DELETE') {
      posts.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: 99 }), { status: 201 });
    }
    const key = Object.keys(routes).filter((k) => url.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    return new Response(JSON.stringify(key ? routes[key] : []), { status: 200 });
  });
  return posts;
}

export const me = (permissions: string[]) => ({ id: 1, permissions, warehouseIds: [1] });
