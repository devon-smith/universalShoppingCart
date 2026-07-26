import { describe, expect, it } from 'vitest';

import { isProtectedPath, isSignedOutOnlyPath } from './middleware';

describe('isProtectedPath', () => {
  it('protects the dashboard and everything under it', () => {
    expect(isProtectedPath('/app')).toBe(true);
    expect(isProtectedPath('/app/cart/abc')).toBe(true);
    expect(isProtectedPath('/app/settings')).toBe(true);
  });

  it('leaves public routes alone', () => {
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/login')).toBe(false);
    expect(isProtectedPath('/privacy')).toBe(false);
    expect(isProtectedPath('/auth/callback')).toBe(false);
  });

  it('does not treat a prefix collision as protected', () => {
    expect(isProtectedPath('/application')).toBe(false);
    expect(isProtectedPath('/appointments')).toBe(false);
  });
});

describe('isSignedOutOnlyPath', () => {
  it('matches the login route', () => {
    expect(isSignedOutOnlyPath('/login')).toBe(true);
    expect(isSignedOutOnlyPath('/login/check-email')).toBe(true);
  });

  it('does not match unrelated routes', () => {
    expect(isSignedOutOnlyPath('/')).toBe(false);
    expect(isSignedOutOnlyPath('/app')).toBe(false);
    expect(isSignedOutOnlyPath('/loginhelp')).toBe(false);
  });
});
