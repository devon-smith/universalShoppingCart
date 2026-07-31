/**
 * Sign-in failures, in the words a person can act on.
 *
 * The Auth server's strings are written for whoever is reading the logs. "Token has expired or
 * is invalid" tells a user two things at once and suggests neither of the two buttons that would
 * fix it.
 *
 * Note what that message does *not* let us do: Supabase answers a mistyped code and a
 * genuinely expired one identically, on purpose — distinguishing them would tell an attacker
 * which codes had once been real. So this cannot say "your code has expired" as though it
 * knew. It offers both readings and the one action that resolves either.
 */

export interface SignInFailure {
  /** The short statement of what happened. */
  title: string;
  /** What to do about it. */
  body: string;
  /** Whether "Send a new code" resolves this. */
  canResend: boolean;
}

/** Sent too often — Supabase rate-limits code requests per address. */
const RATE_LIMITED = /rate limit|too many requests|only request this after/i;
/** A code that the server would not accept, for either of the two reasons it will not name. */
const BAD_CODE = /expired|invalid|not found/i;
const NETWORK = /fetch|network|failed to fetch/i;
/**
 * Our own validation, from `normalizeEmail` and `normalizeCode`. These are already one
 * actionable sentence, so wrapping them in "Sign-in failed" would only add a scarier word.
 */
const OUR_VALIDATION = /^Enter (a valid email address|the 6-digit code)/;

export function describeSignInFailure(message: string): SignInFailure {
  if (OUR_VALIDATION.test(message)) {
    return { title: message, body: '', canResend: false };
  }

  if (RATE_LIMITED.test(message)) {
    return {
      title: 'Too many codes requested',
      body: 'Wait a minute, then ask for another one. The last code sent to you still works.',
      canResend: false,
    };
  }

  if (BAD_CODE.test(message)) {
    return {
      title: 'That code did not work',
      body: 'Codes last one hour and each new one replaces the last. Check the most recent email, or send yourself a new code.',
      canResend: true,
    };
  }

  if (NETWORK.test(message)) {
    return {
      title: 'Could not reach Universal Cart',
      body: 'Check your connection and try again.',
      canResend: false,
    };
  }

  return { title: 'Sign-in failed', body: message, canResend: false };
}
