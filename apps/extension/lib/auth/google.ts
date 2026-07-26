/**
 * Google sign-in for the extension (BUILD_PLAN.md §11.4).
 *
 * The flow never redirects an extension page. Instead the PKCE authorization URL is
 * generated without redirecting, opened in the browser's identity window, and the
 * returned authorization code is exchanged for a Supabase session. Only that session is
 * persisted, in extension-local storage.
 *
 * The dependencies are parameters rather than imports so the whole flow — including its
 * failure paths — is testable without a browser.
 */

/** The part of `chrome.identity` this flow uses. */
export interface IdentityApi {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
}

/** The part of the Supabase auth client this flow uses. */
export interface OAuthCapableAuth {
  signInWithOAuth(params: {
    provider: 'google';
    options: {
      redirectTo: string;
      skipBrowserRedirect: true;
      queryParams?: Record<string, string>;
    };
  }): Promise<{ data: { url: string | null }; error: { message: string } | null }>;
  exchangeCodeForSession(code: string): Promise<{ error: { message: string } | null }>;
}

export class GoogleSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSignInError';
  }
}

/** The path component of the extension's identity redirect URL. */
export const IDENTITY_REDIRECT_PATH = 'auth-callback';

export function extractAuthorizationCode(responseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(responseUrl);
  } catch {
    throw new GoogleSignInError('Google returned a response that was not a URL.');
  }

  // Errors may arrive in the query string or, for some providers, the fragment.
  const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const providerError =
    parsed.searchParams.get('error_description') ??
    parsed.searchParams.get('error') ??
    fragment.get('error_description') ??
    fragment.get('error');

  if (providerError) {
    throw new GoogleSignInError(providerError);
  }

  const code = parsed.searchParams.get('code') ?? fragment.get('code');
  if (!code) {
    throw new GoogleSignInError('Google did not return an authorization code.');
  }

  return code;
}

export async function signInWithGoogle(deps: {
  auth: OAuthCapableAuth;
  identity: IdentityApi;
}): Promise<void> {
  const redirectTo = deps.identity.getRedirectURL(IDENTITY_REDIRECT_PATH);

  const { data, error } = await deps.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });

  if (error) {
    throw new GoogleSignInError(error.message);
  }
  if (!data.url) {
    throw new GoogleSignInError('Supabase did not return an authorization URL.');
  }

  const responseUrl = await deps.identity.launchWebAuthFlow({ url: data.url, interactive: true });

  if (!responseUrl) {
    // Chrome resolves with undefined when the user closes the window.
    throw new GoogleSignInError('Sign-in was cancelled.');
  }

  const code = extractAuthorizationCode(responseUrl);
  const { error: exchangeError } = await deps.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    throw new GoogleSignInError(exchangeError.message);
  }
}
