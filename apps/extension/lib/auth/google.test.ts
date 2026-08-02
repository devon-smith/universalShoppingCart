import { describe, expect, it, vi } from 'vitest';

import type { IdentityApi, OAuthCapableAuth } from './google';
import { extractAuthorizationCode, GoogleSignInError, signInWithGoogle } from './google';

const REDIRECT = 'https://abcdefghijklmnop.chromiumapp.org/auth-callback';

function fakeIdentity(responseUrl: string | undefined): IdentityApi {
  return {
    getRedirectURL: () => REDIRECT,
    launchWebAuthFlow: vi.fn(async () => responseUrl),
  };
}

function fakeAuth(overrides: Partial<OAuthCapableAuth> = {}): OAuthCapableAuth {
  return {
    signInWithOAuth: vi.fn(async () => ({
      data: { url: 'https://accounts.google.com/o/oauth2/auth?state=xyz' },
      error: null,
    })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('extractAuthorizationCode', () => {
  it('reads the code from the query string', () => {
    expect(extractAuthorizationCode(`${REDIRECT}?code=abc123&state=xyz`)).toBe('abc123');
  });

  it('reads the code from the fragment', () => {
    expect(extractAuthorizationCode(`${REDIRECT}#code=abc123`)).toBe('abc123');
  });

  it('surfaces a provider error description', () => {
    expect(() =>
      extractAuthorizationCode(`${REDIRECT}?error=access_denied&error_description=User+said+no`),
    ).toThrow(/User said no/);
  });

  it('surfaces a provider error from the fragment', () => {
    expect(() => extractAuthorizationCode(`${REDIRECT}#error=access_denied`)).toThrow(
      /access_denied/,
    );
  });

  it('rejects a response with neither a code nor an error', () => {
    expect(() => extractAuthorizationCode(`${REDIRECT}?state=xyz`)).toThrow(
      /did not return an authorization code/,
    );
  });

  it('rejects a response that is not a URL', () => {
    expect(() => extractAuthorizationCode('not a url')).toThrow(GoogleSignInError);
  });
});

describe('signInWithGoogle', () => {
  it('exchanges the returned code for a session', async () => {
    const auth = fakeAuth();
    const identity = fakeIdentity(`${REDIRECT}?code=abc123`);

    await signInWithGoogle({ auth, identity });

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: REDIRECT,
        skipBrowserRedirect: true,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
  });

  it('never redirects the extension page itself', async () => {
    const auth = fakeAuth();
    await signInWithGoogle({ auth, identity: fakeIdentity(`${REDIRECT}?code=abc123`) });

    const call = vi.mocked(auth.signInWithOAuth).mock.calls[0]?.[0];
    expect(call?.options.skipBrowserRedirect).toBe(true);
  });

  it('reports a cancelled sign-in rather than hanging', async () => {
    await expect(
      signInWithGoogle({ auth: fakeAuth(), identity: fakeIdentity(undefined) }),
    ).rejects.toThrow(/cancelled/);
  });

  it('reports a Supabase error from the authorization step', async () => {
    const auth = fakeAuth({
      signInWithOAuth: vi.fn(async () => ({
        data: { url: null },
        error: { message: 'Provider google is not enabled' },
      })),
    });

    await expect(
      signInWithGoogle({ auth, identity: fakeIdentity(`${REDIRECT}?code=abc`) }),
    ).rejects.toThrow(/Provider google is not enabled/);
  });

  it('reports a failed code exchange', async () => {
    const auth = fakeAuth({
      exchangeCodeForSession: vi.fn(async () => ({ error: { message: 'code verifier missing' } })),
    });

    await expect(
      signInWithGoogle({ auth, identity: fakeIdentity(`${REDIRECT}?code=abc`) }),
    ).rejects.toThrow(/code verifier missing/);
  });

  it('does not attempt an exchange when the provider reported an error', async () => {
    const auth = fakeAuth();

    await expect(
      signInWithGoogle({ auth, identity: fakeIdentity(`${REDIRECT}?error=access_denied`) }),
    ).rejects.toThrow(GoogleSignInError);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
