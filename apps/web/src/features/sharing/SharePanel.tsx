'use client';

import { INVITABLE_ROLES, type CartRole, type InvitableRole } from '@universal-cart/contracts';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createInvitation, removeMember, revokeInvitation } from './actions';
import { formatExpiry, roleDescription, roleLabel } from './sharing';

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
  const [memberList, setMemberList] = useState<MemberEntry[]>(members);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, startCreate] = useTransition();
  // The id of the invitation / member whose destructive action is in flight, so its own button
  // can show progress. See the note on `revoke` for why these are not optimistic.
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [, startAction] = useTransition();

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
    // Confirmed, not optimistic. Revoking is how a leaked link is pulled, so the row must not
    // disappear until the server says it is gone: an optimistic drop plus a fire-and-forget POST
    // reads as "revoked" even when a reload or navigation aborts the request before it lands. The
    // row stays, the button shows progress, and it clears only on a confirmed success.
    setError(null);
    setRevokingId(id);
    startAction(async () => {
      const result = await revokeInvitation(id);
      if (result.ok) {
        setPending((current) => current.filter((invite) => invite.id !== id));
      } else {
        setError(result.error ?? 'That invitation could not be revoked.');
      }
      setRevokingId(null);
    });
  }

  function remove(userId: string) {
    // Confirmed, not optimistic — same reasoning as `revoke`: the member stays listed until the
    // delete is acknowledged, so navigating away mid-request cannot leave the UI claiming a
    // removal that never reached the database.
    setError(null);
    setRemovingId(userId);
    startAction(async () => {
      const result = await removeMember(cartId, userId);
      if (result.ok) {
        setMemberList((current) => current.filter((member) => member.userId !== userId));
      } else {
        setError(result.error ?? 'That member could not be removed.');
      }
      setRemovingId(null);
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
              // The description is a sibling referenced by aria-describedby, not nested inside the
              // label — otherwise the radio's accessible name becomes "Editor Can add, edit…". The
              // role word is real capitalised text so the name a screen reader reads matches the
              // visible label (a CSS `capitalize` would leave the name lowercase).
              <div key={option} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  id={`share-role-${option}`}
                  name="share-role"
                  className="uc-focusable mt-0.5"
                  checked={role === option}
                  onChange={() => setRole(option)}
                  aria-describedby={`share-role-desc-${option}`}
                />
                <span>
                  <label htmlFor={`share-role-${option}`} className="font-medium">
                    {roleLabel(option)}
                  </label>
                  <span
                    id={`share-role-desc-${option}`}
                    className="block text-xs text-[var(--uc-foreground-muted)]"
                  >
                    {roleDescription(option)}
                  </span>
                </span>
              </div>
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
                  <span className="text-sm font-medium">{roleLabel(invite.role)}</span>
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
                  disabled={revokingId === invite.id}
                  className="uc-button uc-button--ghost uc-focusable shrink-0"
                >
                  {revokingId === invite.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">People with access</h2>
        {/* No empty state: `handle_new_user` writes an owner row into cart_members for every
            cart, so the owner viewing their own cart always appears here — this list is never
            empty. */}
        <ul className="flex flex-col gap-2">
          {memberList.map((member) => {
            const isSelf = member.userId === currentUserId;
            return (
              <li
                key={member.userId}
                className="uc-surface flex items-center justify-between gap-3 p-3"
              >
                <span className="min-w-0 text-sm">
                  {isSelf ? 'You' : `Member ${member.userId.slice(0, 8)}`}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-[var(--uc-foreground-muted)]">
                    {roleLabel(member.role)}
                  </span>
                  {/* The owner cannot remove themselves — ownership is immutable, so it would
                      only strip their listing. Everyone else can be removed. */}
                  {isSelf ? null : (
                    <button
                      type="button"
                      onClick={() => remove(member.userId)}
                      disabled={removingId === member.userId}
                      className="uc-button uc-button--ghost uc-focusable"
                    >
                      {removingId === member.userId ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
