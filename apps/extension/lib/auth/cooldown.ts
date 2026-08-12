/**
 * The resend cooldown, as arithmetic.
 *
 * Supabase throttles code requests per address to one a minute. The panel used to let you
 * press "Send another code" straight into that wall and then explain the refusal; counting
 * down on the button instead turns the server's rule into something visible before it is
 * broken. Sixty seconds mirrors the server's `max_frequency` — if these drift the button
 * merely enables early and the server's message (already handled in messages.ts) catches it.
 */

export const RESEND_COOLDOWN_MS = 60_000;

/** Whole seconds left before another send is worth attempting. Zero means go ahead. */
export function resendRemainingSeconds(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  const remainingMs = sentAt + RESEND_COOLDOWN_MS - now;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}
