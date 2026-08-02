import { describe, expect, it, vi } from 'vitest';

import type { OtpCapableAuth } from './email-otp';
import {
  EmailSignInError,
  normalizeCode,
  normalizeEmail,
  requestEmailCode,
  verifyEmailCode,
} from './email-otp';

function fakeAuth(overrides: Partial<OtpCapableAuth> = {}): OtpCapableAuth {
  return {
    signInWithOtp: vi.fn(async () => ({ error: null })),
    verifyOtp: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects obvious non-addresses before spending a round trip', () => {
    expect(() => normalizeEmail('ada')).toThrow(EmailSignInError);
    expect(() => normalizeEmail('ada@example')).toThrow(EmailSignInError);
    expect(() => normalizeEmail('')).toThrow(EmailSignInError);
  });
});

describe('normalizeCode', () => {
  it('strips the spacing users paste in', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('123-456')).toBe('123456');
    expect(normalizeCode(' 123456 ')).toBe('123456');
  });

  it('rejects anything that is not six digits', () => {
    expect(() => normalizeCode('12345')).toThrow(/6-digit/);
    expect(() => normalizeCode('1234567')).toThrow(/6-digit/);
    expect(() => normalizeCode('abcdef')).toThrow(/6-digit/);
  });
});

describe('requestEmailCode', () => {
  it('asks Supabase to send a code and returns the normalized address', async () => {
    const auth = fakeAuth();
    const email = await requestEmailCode({
      auth,
      email: '  Ada@Example.com ',
      appUrl: 'http://localhost:3000',
    });

    expect(email).toBe('ada@example.com');
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      options: {
        shouldCreateUser: true,
        emailRedirectTo: 'http://localhost:3000/auth/confirm?next=%2Fapp',
      },
    });
  });

  it('does not double the slash when the dashboard URL has a trailing one', async () => {
    const auth = fakeAuth();
    await requestEmailCode({ auth, email: 'ada@example.com', appUrl: 'http://localhost:3000/' });

    const call = vi.mocked(auth.signInWithOtp).mock.calls[0]?.[0];
    expect(call?.options.emailRedirectTo).toBe('http://localhost:3000/auth/confirm?next=%2Fapp');
  });

  it('surfaces a Supabase error', async () => {
    const auth = fakeAuth({
      signInWithOtp: vi.fn(async () => ({ error: { message: 'Email rate limit exceeded' } })),
    });

    await expect(
      requestEmailCode({ auth, email: 'ada@example.com', appUrl: 'http://localhost:3000' }),
    ).rejects.toThrow(/rate limit/);
  });

  it('does not call Supabase for an invalid address', async () => {
    const auth = fakeAuth();
    await expect(
      requestEmailCode({ auth, email: 'nope', appUrl: 'http://localhost:3000' }),
    ).rejects.toThrow(EmailSignInError);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });
});

describe('verifyEmailCode', () => {
  it('verifies the normalized code', async () => {
    const auth = fakeAuth();
    await verifyEmailCode({ auth, email: 'Ada@example.com', code: '123 456' });

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'ada@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('surfaces a rejected code', async () => {
    const auth = fakeAuth({
      verifyOtp: vi.fn(async () => ({ error: { message: 'Token has expired or is invalid' } })),
    });

    await expect(
      verifyEmailCode({ auth, email: 'ada@example.com', code: '123456' }),
    ).rejects.toThrow(/expired or is invalid/);
  });

  it('does not call Supabase for a malformed code', async () => {
    const auth = fakeAuth();
    await expect(verifyEmailCode({ auth, email: 'ada@example.com', code: '12' })).rejects.toThrow(
      EmailSignInError,
    );
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
});
