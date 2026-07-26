import { describe, expect, it } from 'vitest';

import { DEFAULT_SIGNED_IN_PATH, safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
  it('keeps a same-origin path', () => {
    expect(safeRedirectPath('/app/cart/abc')).toBe('/app/cart/abc');
    expect(safeRedirectPath('/app?view=cards')).toBe('/app?view=cards');
  });

  it('falls back when nothing was requested', () => {
    expect(safeRedirectPath(null)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath('')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('refuses to bounce a signed-in user off-origin', () => {
    expect(safeRedirectPath('https://evil.example.com')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath('//evil.example.com')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath('/\\evil.example.com')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath('\\\\evil.example.com')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath('javascript:alert(1)')).toBe(DEFAULT_SIGNED_IN_PATH);
  });

  it('rejects control characters used to smuggle headers', () => {
    expect(safeRedirectPath('/app\nSet-Cookie: a=b')).toBe(DEFAULT_SIGNED_IN_PATH);
    expect(safeRedirectPath('/app\r\nLocation: https://evil.example.com')).toBe(
      DEFAULT_SIGNED_IN_PATH,
    );
  });
});
