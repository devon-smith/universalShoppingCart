'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { acceptInvitation, type AcceptInvitationActionResult } from './actions';

/**
 * The invitee's side of a shared-cart link.
 *
 * Acceptance is a deliberate button press, never automatic on page load: opening a link is not
 * consent to join, and a bare `GET` that mutates membership would be a CSRF foothold. The button
 * calls the Server Action, which owns the single-use and expiry checks; this only renders what it
 * returns.
 */
export function AcceptInvitation({ token }: { token: string }) {
  const [isAccepting, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<AcceptInvitationActionResult | null>(null);

  function accept() {
    startTransition(async () => {
      setOutcome(await acceptInvitation(token));
    });
  }

  if (outcome?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="uc-callout uc-callout--success">
          You now have <strong>{outcome.result.role}</strong> access to this shared cart.
        </p>
        <Link href="/app" className="uc-button uc-button--primary uc-button--full uc-focusable">
          Open the cart
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {outcome && !outcome.ok ? (
        <p role="alert" className="uc-callout uc-callout--danger">
          {outcome.error}
        </p>
      ) : null}
      <p className="text-sm leading-relaxed text-[var(--uc-foreground-muted)]">
        Accepting adds this cart to your account so you can see and compare its items. You can leave
        it at any time.
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={isAccepting}
        className="uc-button uc-button--primary uc-button--full uc-focusable"
      >
        {isAccepting ? 'Accepting…' : 'Accept invitation'}
      </button>
      <Link href="/app" className="uc-button uc-button--ghost uc-button--full uc-focusable">
        Not now
      </Link>
    </div>
  );
}
