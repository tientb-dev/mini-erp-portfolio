import { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

export const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

/** Routes fetch calls by path to canned JSON; records POST/PATCH bodies. */
export function mockApi(routes: Record<string, unknown>) {
  const posts: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, '');
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      posts.push({ url, body: JSON.parse(String(init.body ?? '{}')) });
      return new Response(JSON.stringify({ id: 99 }), { status: 201 });
    }
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : []), { status: 200 });
  });
  return posts;
}

export const me = (permissions: string[]) => ({ id: 1, permissions, warehouseIds: [1] });
