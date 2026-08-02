/**
 * Supabase connection details baked into the extension bundle at build time.
 *
 * Anyone who installs the extension can read these, so only the project URL and the
 * publishable key belong here. A service-role key or an OAuth client secret in the
 * bundle is a security incident (BUILD_PLAN.md §11.4, §17.2).
 */
export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export class SupabaseNotConfiguredError extends Error {
  constructor(detail: string) {
    super(
      `Supabase is not configured. ${detail} Copy apps/extension/.env.example to .env and fill in the values printed by \`pnpm supabase:status\`, then rebuild.`,
    );
    this.name = 'SupabaseNotConfiguredError';
  }
}

export function parseSupabaseConfig(source: Record<string, string | undefined>): SupabaseConfig {
  const url = source.WXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = source.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url) {
    throw new SupabaseNotConfiguredError('WXT_PUBLIC_SUPABASE_URL is missing.');
  }
  if (!publishableKey) {
    throw new SupabaseNotConfiguredError('WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SupabaseNotConfiguredError(`WXT_PUBLIC_SUPABASE_URL (${url}) is not a URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SupabaseNotConfiguredError(`WXT_PUBLIC_SUPABASE_URL (${url}) must be http or https.`);
  }

  // A key shaped like a JWT with a service_role claim would be catastrophic to ship.
  // This is a build-time smoke test, not a substitute for the CI secret scan.
  if (publishableKey.includes('service_role')) {
    throw new SupabaseNotConfiguredError(
      'WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY looks like a service-role key. Use the publishable key.',
    );
  }

  return { url: parsed.origin + parsed.pathname.replace(/\/$/, ''), publishableKey };
}

export function isSupabaseConfigured(source: Record<string, string | undefined>): boolean {
  try {
    parseSupabaseConfig(source);
    return true;
  } catch {
    return false;
  }
}

const environment: Record<string, string | undefined> = {
  WXT_PUBLIC_SUPABASE_URL: import.meta.env.WXT_PUBLIC_SUPABASE_URL,
  WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: import.meta.env.WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
};

export function getSupabaseConfig(): SupabaseConfig {
  return parseSupabaseConfig(environment);
}

export function hasSupabaseConfig(): boolean {
  return isSupabaseConfigured(environment);
}
