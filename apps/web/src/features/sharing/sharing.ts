import type { InvitableRole } from '@universal-cart/contracts';

/**
 * Framework-free logic behind the sharing surface (BUILD_PLAN.md §12, §8.3).
 *
 * Everything here is pure so it can be unit-tested without a database or a browser: the two
 * things that are easy to get subtly wrong — mapping the accept RPC's SQLSTATEs to a message a
 * person can act on, and deciding which stored invitations are still live — live here rather
 * than inside a Server Action or a component.
 */

/** The base app URL plus a raw token → the link an invitee opens. */
export function inviteUrl(appUrl: string, token: string): string {
  // `new URL` keeps this correct whether or not `appUrl` carries a trailing slash.
  return new URL(`/invite/${token}`, appUrl).toString();
}

/**
 * `ttlHours` → a Postgres interval literal for the RPC's `p_ttl`.
 *
 * `undefined` is returned unchanged so the argument is omitted and the RPC's own default
 * (seven days) stands — a caller that did not choose a lifetime must not be given zero.
 */
export function ttlToInterval(ttlHours: number | undefined): string | undefined {
  if (ttlHours === undefined) return undefined;
  return `${ttlHours} hours`;
}

/** Why an accept attempt did not grant access. */
export type AcceptFailure =
  'not_found' | 'expired' | 'already_accepted' | 'unauthenticated' | 'invalid' | 'unknown';

interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Map an `accept_cart_invitation` error to a typed reason.
 *
 * The function raises a distinct SQLSTATE per condition; two of them share `22023`
 * (invalid_parameter_value) and are told apart by the message, which is committed source and
 * therefore stable. A `no_data_found` raise surfaces as `P0002`, not `02000`.
 */
export function acceptFailureReason(error: PostgrestErrorLike): AcceptFailure {
  const code = error.code ?? '';
  const message = (error.message ?? '').toLowerCase();
  switch (code) {
    case 'P0002': // no_data_found — no invitation with that token hash
      return 'not_found';
    case '42501': // insufficient_privilege — not authenticated
      return 'unauthenticated';
    case '22P02': // invalid_text_representation — the token is malformed
      return 'invalid';
    case '22023': // invalid_parameter_value — expired or already accepted
      if (message.includes('expired')) return 'expired';
      if (message.includes('already')) return 'already_accepted';
      return 'invalid';
    default:
      return 'unknown';
  }
}

const ACCEPT_MESSAGES: Record<AcceptFailure, string> = {
  not_found: 'This invitation link is not valid. Ask the cart owner for a new one.',
  expired: 'This invitation has expired. Ask the cart owner to send a new one.',
  already_accepted: 'This invitation has already been used.',
  unauthenticated: 'You need to be signed in to accept an invitation.',
  invalid: 'This invitation link is malformed.',
  unknown: 'The invitation could not be accepted. Please try again.',
};

export function acceptFailureMessage(reason: AcceptFailure): string {
  return ACCEPT_MESSAGES[reason];
}

export interface PendingInvitationLike {
  accepted_at: string | null;
  expires_at: string;
}

/** An invitation is still pending if nobody has accepted it and it has not expired. */
export function isPending(invitation: PendingInvitationLike, now: Date): boolean {
  return (
    invitation.accepted_at === null && new Date(invitation.expires_at).getTime() > now.getTime()
  );
}

/** A short, human relative expiry: "in 6 days", "in 3 hours", "soon", or "expired". */
export function formatExpiry(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 'expired';
  const hours = ms / 3_600_000;
  if (hours < 1) return 'soon';
  if (hours < 48) {
    const whole = Math.round(hours);
    return `in ${whole} hour${whole === 1 ? '' : 's'}`;
  }
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** What an invited role may do, for the invite form and the pending/members lists. */
export function roleDescription(role: InvitableRole): string {
  return role === 'editor'
    ? 'Can add, edit, and remove items'
    : 'Can view items, but not change them';
}
