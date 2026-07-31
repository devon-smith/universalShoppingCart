/**
 * Which sign-in methods the Auth server actually has switched on.
 *
 * The panel used to offer "Continue with Google" unconditionally. Local Supabase ships with
 * `[auth.external.google] enabled = false`, so on every developer machine — and on any project
 * where the provider was never configured — that button opened an OAuth window that could only
 * fail. Offering a method that cannot work is worse than not offering it: the user assumes
 * their account is broken rather than that the button was decorative.
 *
 * A build-time flag would answer the question without a request, but it is a copy of a fact
 * owned by the Auth server, and copies drift. This asks the server. `fetch` is a parameter so
 * the whole thing, failures included, is testable without a network.
 */

export interface EnabledProviders {
  google: boolean;
  email: boolean;
}

/** What the panel falls back to when the server cannot be reached. */
export const PROVIDERS_UNKNOWN: EnabledProviders = { google: false, email: true };

interface SettingsShape {
  external?: Record<string, unknown>;
}

export async function fetchEnabledProviders(deps: {
  url: string;
  publishableKey: string;
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
}): Promise<EnabledProviders> {
  try {
    const response = await deps.fetch(`${deps.url.replace(/\/$/, '')}/auth/v1/settings`, {
      headers: { apikey: deps.publishableKey },
      signal: deps.signal,
    });

    if (!response.ok) return PROVIDERS_UNKNOWN;

    const body = (await response.json()) as SettingsShape;
    const external = body.external ?? {};

    return {
      google: external.google === true,
      // Email is the fallback method and the one the panel implements; if the server says
      // nothing, assume it is available rather than leaving no way in at all.
      email: external.email !== false,
    };
  } catch {
    // A closed laptop lid, a paused project, a blocked request. None of these are worth an
    // error state on the sign-in screen — email still works, so offer it and stay quiet.
    return PROVIDERS_UNKNOWN;
  }
}
