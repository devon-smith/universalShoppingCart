import { describe, expect, it } from 'vitest';

import { parsePublicEnv } from './env';

describe('parsePublicEnv', () => {
  it('falls back to the local dev origin', () => {
    expect(parsePublicEnv({})).toEqual({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
  });

  it('accepts an explicit app URL', () => {
    expect(parsePublicEnv({ NEXT_PUBLIC_APP_URL: 'https://cart.example.com' })).toEqual({
      NEXT_PUBLIC_APP_URL: 'https://cart.example.com',
    });
  });

  it('rejects a malformed app URL instead of silently defaulting', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_APP_URL: 'not-a-url' })).toThrow(
      /Invalid public web environment/,
    );
  });
});
