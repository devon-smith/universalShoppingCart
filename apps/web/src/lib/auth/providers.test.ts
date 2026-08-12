import { describe, expect, it, vi } from 'vitest';

import { fetchEnabledProviders, PROVIDERS_UNKNOWN } from './providers';

function fetchReturning(body: unknown, ok = true): typeof globalThis.fetch {
  return vi.fn(async () =>
    ok
      ? new Response(JSON.stringify(body), { status: 200 })
      : new Response('nope', { status: 500 }),
  ) as unknown as typeof globalThis.fetch;
}

const deps = { url: 'https://project.supabase.co', publishableKey: 'sb_publishable_x' };

describe('fetchEnabledProviders', () => {
  it('reports google only when the server says it is on', async () => {
    const on = await fetchEnabledProviders({
      ...deps,
      fetch: fetchReturning({ external: { google: true, email: true } }),
    });
    expect(on.google).toBe(true);

    const off = await fetchEnabledProviders({
      ...deps,
      fetch: fetchReturning({ external: { email: true } }),
    });
    expect(off.google).toBe(false);
  });

  it('assumes email is available unless the server denies it', async () => {
    const silent = await fetchEnabledProviders({ ...deps, fetch: fetchReturning({}) });
    expect(silent.email).toBe(true);

    const denied = await fetchEnabledProviders({
      ...deps,
      fetch: fetchReturning({ external: { email: false } }),
    });
    expect(denied.email).toBe(false);
  });

  it('falls back to email-only when the request fails or errors', async () => {
    expect(await fetchEnabledProviders({ ...deps, fetch: fetchReturning({}, false) })).toEqual(
      PROVIDERS_UNKNOWN,
    );

    const throwing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;
    expect(await fetchEnabledProviders({ ...deps, fetch: throwing })).toEqual(PROVIDERS_UNKNOWN);
  });
});
