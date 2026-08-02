/**
 * Build-time public configuration for the extension bundle.
 *
 * WXT inlines `import.meta.env.WXT_PUBLIC_*` at build time. Only client-safe values
 * belong here: the Supabase project URL and publishable key are fine, a service-role
 * key or an OAuth client secret is never acceptable (BUILD_PLAN.md §11.4, §17.2).
 */
export interface PublicEnv {
  WXT_PUBLIC_APP_URL: string;
}

export const DEFAULT_APP_URL = 'http://localhost:3000';

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const appUrl = source.WXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) {
    return { WXT_PUBLIC_APP_URL: DEFAULT_APP_URL };
  }

  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error(`Invalid WXT_PUBLIC_APP_URL: ${appUrl} is not a URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid WXT_PUBLIC_APP_URL: ${appUrl} must be http or https`);
  }

  return { WXT_PUBLIC_APP_URL: parsed.toString() };
}

export const publicEnv: PublicEnv = parsePublicEnv({
  WXT_PUBLIC_APP_URL: import.meta.env.WXT_PUBLIC_APP_URL,
});
