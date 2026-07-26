import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_URL, parsePublicEnv } from './env';

describe('parsePublicEnv', () => {
  it('falls back to the local dashboard origin', () => {
    expect(parsePublicEnv({})).toEqual({ WXT_PUBLIC_APP_URL: DEFAULT_APP_URL });
    expect(parsePublicEnv({ WXT_PUBLIC_APP_URL: '   ' })).toEqual({
      WXT_PUBLIC_APP_URL: DEFAULT_APP_URL,
    });
  });

  it('accepts an explicit https dashboard URL', () => {
    expect(parsePublicEnv({ WXT_PUBLIC_APP_URL: 'https://cart.example.com' })).toEqual({
      WXT_PUBLIC_APP_URL: 'https://cart.example.com/',
    });
  });

  it('rejects a non-URL value', () => {
    expect(() => parsePublicEnv({ WXT_PUBLIC_APP_URL: 'nope' })).toThrow(/is not a URL/);
  });

  it('rejects a non-web scheme so the panel cannot link somewhere unexpected', () => {
    expect(() => parsePublicEnv({ WXT_PUBLIC_APP_URL: 'javascript:alert(1)' })).toThrow(
      /must be http or https/,
    );
    expect(() => parsePublicEnv({ WXT_PUBLIC_APP_URL: 'file:///etc/passwd' })).toThrow(
      /must be http or https/,
    );
  });
});
