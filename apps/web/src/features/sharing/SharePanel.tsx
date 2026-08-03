'use client';

import { INVITABLE_ROLES, type CartRole, type InvitableRole } from '@universal-cart/contracts';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createInvitation, revokeInvitation } from './actions';
import { formatExpiry, roleDescription } from './sharing';

export interface OwnedCart {
  id: string;
  name: string;
  is_default: boolean;
}

export interface PendingInvite {
  id: string;
  role: InvitableRole;
  email: string | null;
  expiresAt: string;
}

export interface MemberEntry {
  userId: string;
  role: CartRole;
}

/** Lifetimes offered for a new link — capped well under MAX_INVITE_TTL_HOURS (30 days). */
const LIFETIMES = [
  { label: '1 day', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
] as const;

/**
 * The cart owner's sharing surface (BUILD_PLAN.md §12, §8.3).
 *
 * Invitations are the point: mint a link for a cart you own, hand it to a friend, and pull it if
 * it leaks. The raw token comes back from the RPC exactly once, so the freshly-created link is
 * shown with a plain warning that it will not be seen again. Members are shown read-only and
 * without names — a member's `profiles` row is not readable across accounts, and inventing a
 * display name would be worse than an honest short id.
 */
export function SharePanel({
  cartId,
  carts,
  currentUserId,
  initialPending,
  members,
  nowIso,
}: {
  cartId: string;
  carts: OwnedCart[];
  currentUserId: string;
  initialPending: PendingInvite[];
  members: MemberEntry[];
  nowIso: string;
}) {
  const router = useRouter();
  const now = new Date(nowIso);

  const [role, setRole] = useState<InvitableRole>('editor');
  const [hours, setHours] = useState<number>(168);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState<PendingInvite[]>(initialPending);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, startCreate] = useTransition();

  function submit() {
    setError(null);
    setCreatedUrl(null);
    setCopied(false);
    startCreate(async () => {
      const result = await createInvitation({
        cartId,
        role,
        email: email.trim() === '' ? undefined : email.trim(),
        ttlHours: hours,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreatedUrl(result.url);
      setPending((current) => [
        {
          id: result.invitation.id,
          role: result.invitation.role,
          email: email.trim() === '' ? null : email.trim(),
          expiresAt: result.invitation.expiresAt,
        },
        ...current,
      ]);
      setEmail('');
    });
  }

  function revoke(id: string) {
    // Optimistic: drop it now, restore on failure. A revoke that fails RLS never had an effect.
    const previous = pending;
    setPending((current) => current.filter((invite) => invite.id !== id));
    void revokeInvitation(id).then((result) => {
      if (!result.ok) {
        setError(result.error ?? 'That invitation could not be revoked.');
        setPending(previous);
      }
    });
  }

  async function copy() {
    if (!createdUrl || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the link is selectable in the field regardless.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {carts.length > 1 ? (
        <div className="uc-field">
          <label className="uc-field__label" htmlFor="share-cart">
            Cart to share
          </label>
          <select
            id="share-cart"
            className="uc-input uc-focusable"
            value={cartId}
            onChange={(event) => router.push(`/app/share?cart=${event.target.value}`)}
          >
            {carts.map((cart) => (
              <option key={cart.id} value={cart.id}>
                {cart.name}
                {cart.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <section className="uc-surface uc-surface--raised flex flex-col gap-4 p-4">
        <h2 className="text-lg font-semibold">Invite someone</h2>

        {error ? (
          <p role="alert" className="uc-callout uc-callout--danger">
            {error}
          </p>
        ) : null}

        <fieldset className="uc-field">
          <legend className="uc-field__label">Their access</legend>
          <div className="flex flex-col gap-2">
            {INVITABLE_ROLES.map((option) => (
              <label key={option} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="share-role"
                  className="uc-focusable mt-0.5"
                  checked={role === option}
                  onChange={() => setRole(option)}
                />
                <span>
                  <span className="font-medium capitalize">{option}</span>
                  <span className="block text-xs text-[var(--uc-foreground-muted)]">
                    {roleDescription(option)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="uc-field">
          <label className="uc-field__label" htmlFor="share-ttl">
            Link expires after
          </label>
          <select
            id="share-ttl"
            className="uc-input uc-focusable"
            value={hours}
            onChange={(event) => setHours(Number(event.target.value))}
          >
            {LIFETIMES.map((option) => (
              <option key={option.hours} value={option.hours}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="uc-field">
          <label className="uc-field__label" htmlFor="share-email">
            Their email <span className="text-[var(--uc-foreground-muted)]">(optional)</span>
          </label>
          <input
            id="share-email"
            type="email"
            className="uc-input uc-focusable"
            placeholder="friend@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="text-xs text-[var(--uc-foreground-muted)]">
            A reminder for you only — anyone with the link can accept it.
          </p>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={isCreating}
          className="uc-button uc-button--primary uc-focusable"
        >
          {isCreating ? 'Creating link…' : 'Create invitation link'}
        </button>

        {createdUrl ? (
          <div className="uc-callout uc-callout--warning flex flex-col gap-2">
            <p className="text-sm font-medium">
              Copy this link now — it is shown once and cannot be retrieved again.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                aria-label="Invitation link"
                className="uc-input uc-focusable min-w-0 flex-1 font-mono text-xs"
                value={createdUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                onClick={copy}
                className="uc-button uc-button--secondary uc-focusable shrink-0"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Pending invitations</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-[var(--uc-foreground-muted)]">
            No links are waiting to be accepted.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((invite) => (
              <li
                key={invite.id}
                className="uc-surface flex items-center justify-between gap-3 p-3"
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium capitalize">{invite.role}</span>
                  {invite.email ? (
                    <span className="block truncate text-xs text-[var(--uc-foreground-muted)]">
                      {invite.email}
                    </span>
                  ) : null}
                  <span className="block text-xs text-[var(--uc-foreground-muted)]">
                    Expires {formatExpiry(invite.expiresAt, now)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => revoke(invite.id)}
                  className="uc-button uc-button--ghost uc-focusable shrink-0"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">People with access</h2>
        {members.length === 0 ? (
          <p className="text-sm text-[var(--uc-foreground-muted)]">
            Only you, so far. Invited members appear here once they accept.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((member) => (
              <li
                key={member.userId}
                className="uc-surface flex items-center justify-between gap-3 p-3"
              >
                <span className="text-sm">
                  {member.userId === currentUserId ? 'You' : `Member ${member.userId.slice(0, 8)}`}
                </span>
                <span className="text-xs text-[var(--uc-foreground-muted)] capitalize">
                  {member.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
