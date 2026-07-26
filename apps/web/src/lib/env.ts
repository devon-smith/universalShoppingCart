import { z } from 'zod';

/**
 * Client-visible web configuration.
 *
 * Only values that are safe in a browser bundle belong here (BUILD_PLAN.md §17.2).
 * Server-only secrets — the Supabase service-role key, cron secrets, provider keys —
 * are read in server modules and must never be given a `NEXT_PUBLIC_` prefix.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so each variable has
 * to be referenced by its full literal name rather than looked up dynamically.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid public web environment — ${issues}`);
  }

  return result.data;
}

export const publicEnv: PublicEnv = parsePublicEnv({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
