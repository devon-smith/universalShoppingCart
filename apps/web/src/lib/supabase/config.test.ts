import { describe, expect, it } from 'vitest';

import { parseSupabaseConfig, SupabaseNotConfiguredError } from './config';

describe('parseSupabaseConfig', () => {
  it('accepts a URL and a publishable key', () => {
    expect(
      parseSupabaseConfig({ url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_abc' }),
    ).toEqual({ url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_abc' });
  });

  it('explains what is missing instead of constructing a broken client', () => {
    expect(() => parseSupabaseConfig({ url: undefined, publishableKey: undefined })).toThrow(
      SupabaseNotConfiguredError,
    );
    expect(() =>
      parseSupabaseConfig({ url: undefined, publishableKey: 'sb_publishable_abc' }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() =>
      parseSupabaseConfig({ url: 'http://127.0.0.1:54321', publishableKey: '' }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it('rejects a non-URL project URL', () => {
    expect(() => parseSupabaseConfig({ url: 'localhost', publishableKey: 'k' })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
  });

  it('points the developer at the setup command', () => {
    expect(() => parseSupabaseConfig({ url: undefined, publishableKey: undefined })).toThrow(
      /pnpm supabase:status/,
    );
  });
});
