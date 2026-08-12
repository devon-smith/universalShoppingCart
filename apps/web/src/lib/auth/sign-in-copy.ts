/**
 * Sign-in failures, in words a person can act on.
 *
 * The Auth server's strings are written for whoever reads the logs. The two that real users
 * actually meet — the per-address send throttle and a dead magic link — both have a clear
 * next step that the raw message does not state. Everything else passes through untouched:
 * inventing friendlier text for a message we do not recognise trades accuracy for tone.
 *
 * The extension side panel has its own copy of this idea for its code-based flow
 * (apps/extension/lib/auth/messages.ts); the wording here is the web's, where sign-in is a
 * link rather than a code.
 */

/** Sent too often — Supabase throttles sends per address. */
const RATE_LIMITED = /rate limit|too many requests|only request this after/i;

export function describeSendFailure(message: string): string {
  if (RATE_LIMITED.test(message)) {
    return 'You asked for sign-in emails quickly in a row. Wait a minute, then try again — the last email still works.';
  }
  return message;
}

/**
 * Shown when a magic link fails to verify. Supabase answers an expired link and an
 * already-used one identically, so this names both and the one action that resolves either.
 */
export const DEAD_LINK_MESSAGE =
  'That sign-in link has expired or was already used. Each link works once — enter your email below and we will send a fresh one.';
