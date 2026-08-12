/**
 * Which sign-in methods the Auth server actually has switched on.
 *
 * The login page used to offer "Continue with Google" unconditionally. On any project where
 * the provider was never configured — every local stack, and hosted until someone completes
 * the OAuth setup — that button started a flow that could only fail, and a person who clicks
 * it concludes their Google account is the problem. The extension panel already asks the
 * server before offering the button (apps/extension/lib/auth/providers.ts); this is the same
 * question asked server-side, where the login page renders.
 *
 * Deliberately a sibling of the extension module rather than a shared package: each client
 * owns its fallback behaviour, and the fetch shape is small enough that a package boundary
 * would cost more than the duplication.
 */

export interface EnabledProviders {
  google: boolean;
  email: boolean;
}

/** The fallback when the server cannot be reached: email works, extras stay hidden. */
export const PROVIDERS_UNKNOWN: EnabledProviders = { google: false, email: true };

interface SettingsShape {
  external?: Record<string, unknown>;
}

export async function fetchEnabledProviders(deps: {
  url: string;
  publishableKey: string;
  fetch: typeof globalThis.fetch;
}): Promise<EnabledProviders> {
  try {
    const response = await deps.fetch(`${deps.url.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: deps.publishableKey },
      // Per-request, uncached: the answer changes when someone flips the provider on in the
      // dashboard, and a login page serving yesterday's answer re-creates the dead button.
      cache: 'no-store',
    });

    if (!response.ok) return PROVIDERS_UNKNOWN;

    const body = (await response.json()) as SettingsShape;
    const external = body.external ?? {};

    return {
      google: external.google === true,
      email: external.email !== false,
    };
  } catch {
    // An unreachable Auth server will fail the actual sign-in too, but email's failure is
    // legible there; a broken login page is not.
    return PROVIDERS_UNKNOWN;
  }
}
