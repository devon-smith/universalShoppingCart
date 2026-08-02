import { describe, expect, it } from 'vitest';

import { isSupabaseConfigured, parseSupabaseConfig, SupabaseNotConfiguredError } from './config';

const valid = {
  WXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc',
};

describe('parseSupabaseConfig', () => {
  it('accepts a URL and publishable key', () => {
    expect(parseSupabaseConfig(valid)).toEqual({
      url: 'http://127.0.0.1:54321',
      publishableKey: 'sb_publishable_abc',
    });
  });

  it('normalizes a trailing slash so the URL is stable across builds', () => {
    expect(
      parseSupabaseConfig({ ...valid, WXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/' }).url,
    ).toBe('http://127.0.0.1:54321');
  });

  it('names the missing variable', () => {
    expect(() => parseSupabaseConfig({})).toThrow(/WXT_PUBLIC_SUPABASE_URL is missing/);
    expect(() =>
      parseSupabaseConfig({ WXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }),
    ).toThrow(/WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing/);
  });

  it('rejects a non-web scheme', () => {
    expect(() =>
      parseSupabaseConfig({ ...valid, WXT_PUBLIC_SUPABASE_URL: 'file:///etc/passwd' }),
    ).toThrow(/must be http or https/);
  });

  it('refuses to ship a service-role key in the bundle', () => {
    expect(() =>
      parseSupabaseConfig({
        ...valid,
        WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.service_role',
      }),
    ).toThrow(SupabaseNotConfiguredError);
  });

  it('reports configuration status without throwing', () => {
    expect(isSupabaseConfigured(valid)).toBe(true);
    expect(isSupabaseConfigured({})).toBe(false);
  });
});
