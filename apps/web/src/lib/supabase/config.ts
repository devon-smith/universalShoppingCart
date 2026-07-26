import { z } from 'zod';

/**
 * Supabase connection details for the browser and for server-rendered requests.
 *
 * Both values are client-safe: the project URL is public, and the publishable key
 * carries no authority beyond what Row Level Security allows the caller. The
 * service-role key is not read here and must never be given a `NEXT_PUBLIC_` prefix
 * (BUILD_PLAN.md §17.2).
 *
 * The parse is lazy on purpose. Reading it at module scope would make `next build`
 * fail on a clean clone that has not been pointed at a Supabase project yet; failing
 * at client-construction time instead gives the same protection with a clearer message.
 */
const supabaseConfigSchema = z.object({
  url: z.url({ error: 'NEXT_PUBLIC_SUPABASE_URL must be a URL' }),
  publishableKey: z
    .string()
    .min(1, { error: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must not be empty' }),
});

export type SupabaseConfig = z.infer<typeof supabaseConfigSchema>;

export class SupabaseNotConfiguredError extends Error {
  constructor(detail: string) {
    super(
      `Supabase is not configured. ${detail} Copy apps/web/.env.example to .env.local and fill in the values printed by \`pnpm supabase:status\`.`,
    );
    this.name = 'SupabaseNotConfiguredError';
  }
}

export function parseSupabaseConfig(source: {
  url: string | undefined;
  publishableKey: string | undefined;
}): SupabaseConfig {
  const result = supabaseConfigSchema.safeParse({
    url: source.url,
    publishableKey: source.publishableKey,
  });

  if (!result.success) {
    throw new SupabaseNotConfiguredError(
      result.error.issues.map((issue) => issue.message).join('; ') + '.',
    );
  }

  return result.data;
}

/** True when both public Supabase variables are present. Used to render setup guidance. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getSupabaseConfig(): SupabaseConfig {
  // Next.js inlines these by literal name; a dynamic lookup would not be replaced.
  return parseSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
