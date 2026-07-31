import { describe, expect, it, vi } from 'vitest';

import { PROVIDERS_UNKNOWN, fetchEnabledProviders } from './providers';

const CONFIG = { url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_test' };

function respondWith(body: unknown, ok = true): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;
}

describe('fetchEnabledProviders', () => {
  it('reports google off when the project has not configured it', async () => {
    const providers = await fetchEnabledProviders({
      ...CONFIG,
      fetch: respondWith({ external: { google: false, email: true } }),
    });

    expect(providers.google).toBe(false);
    expect(providers.email).toBe(true);
  });

  it('reports google on when the project has configured it', async () => {
    const providers = await fetchEnabledProviders({
      ...CONFIG,
      fetch: respondWith({ external: { google: true, email: true } }),
    });

    expect(providers.google).toBe(true);
  });

  it('asks the auth settings endpoint with the publishable key', async () => {
    const fetcher = respondWith({ external: {} });
    await fetchEnabledProviders({ ...CONFIG, fetch: fetcher });

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:54321/auth/v1/settings', {
      headers: { apikey: 'sb_publishable_test' },
      signal: undefined,
    });
  });

  it('does not offer google when the response omits it', async () => {
    const providers = await fetchEnabledProviders({ ...CONFIG, fetch: respondWith({}) });
    expect(providers.google).toBe(false);
  });

  it('hides google rather than guessing when the request fails', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const providers = await fetchEnabledProviders({ ...CONFIG, fetch: failing });

    expect(providers).toEqual(PROVIDERS_UNKNOWN);
    expect(providers.google).toBe(false);
    // Email is the panel's own method, so a failed probe must not remove the only way in.
    expect(providers.email).toBe(true);
  });

  it('hides google when the server answers with an error status', async () => {
    const providers = await fetchEnabledProviders({
      ...CONFIG,
      fetch: respondWith({ external: { google: true } }, false),
    });

    expect(providers.google).toBe(false);
  });

  it('tolerates a trailing slash on the project url', async () => {
    const fetcher = respondWith({ external: {} });
    await fetchEnabledProviders({ ...CONFIG, url: 'http://127.0.0.1:54321/', fetch: fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:54321/auth/v1/settings',
      expect.anything(),
    );
  });
});
