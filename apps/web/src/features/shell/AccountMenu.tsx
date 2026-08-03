'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import { useDismissable, useReturnFocus } from './useDismissable';

/**
 * Identity and the things you do once a month.
 *
 * The dashboard used to print "Signed in as …" as a subtitle under the page heading and put
 * "Extractor health" beside it as a primary action. Neither earns that space: an address you
 * already know, and a diagnostics page that names DOM markup and extractor versions. Both
 * belong behind a menu, which is also where sign-out has always belonged.
 *
 * Diagnostics stays reachable and stays honest about what it is — a developer tool, listed as
 * one, not a shopping destination in the main navigation.
 */
export function AccountMenu({ email, signOut }: { email: string; signOut: () => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useDismissable(open, container, () => setOpen(false));
  useReturnFocus(open, trigger);

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        ref={trigger}
        data-testid="account-menu"
        className="uc-focusable flex w-full items-center gap-2 rounded-[var(--uc-radius-control)] px-2 py-1.5 text-left text-sm hover:bg-[var(--uc-surface-muted)]"
        aria-expanded={open}
        // Deliberately no `aria-haspopup`. Every one of its values names a specific widget —
        // and `true` is a synonym for `menu` — so any of them would promise the arrow-key
        // navigation the panel below explains it does not implement. `aria-expanded` alone is
        // the disclosure pattern, and it is what this is.
        aria-controls="account-menu-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--uc-surface-muted)] text-xs font-semibold"
        >
          {email.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[var(--uc-foreground-muted)]">{email}</span>
        <span aria-hidden="true" className="text-[var(--uc-foreground-muted)]">
          ⋯
        </span>
      </button>

      {/* A labelled group of ordinary buttons and links, not `role="menu"`. That role promises
          arrow-key navigation and typeahead, which this does not implement — and it replaces
          the implicit button/link role, so assistive technology would stop calling these what
          they are.

          `role="group"` is what makes the label count: `aria-label` on a bare `div` has no
          role to attach to and is dropped, so the panel was reaching screen readers unnamed. */}
      {open ? (
        <div
          id="account-menu-panel"
          role="group"
          aria-label="Account"
          className="uc-surface uc-surface--overlay absolute bottom-full left-0 z-30 mb-1 flex w-full min-w-56 flex-col gap-1 p-2"
        >
          <p className="px-2 py-1 text-xs text-[var(--uc-foreground-muted)]">
            Signed in as {email}
          </p>

          <Link
            href="/app/share"
            className="uc-focusable rounded-[var(--uc-radius-control)] px-2 py-1.5 text-sm hover:bg-[var(--uc-surface-muted)]"
            onClick={() => setOpen(false)}
          >
            Share a cart
            <span className="block text-xs text-[var(--uc-foreground-muted)]">
              Invite someone to see and compare its items
            </span>
          </Link>

          <Link
            href="/app/diagnostics"
            className="uc-focusable rounded-[var(--uc-radius-control)] px-2 py-1.5 text-sm hover:bg-[var(--uc-surface-muted)]"
            onClick={() => setOpen(false)}
          >
            Extractor health
            <span className="block text-xs text-[var(--uc-foreground-muted)]">
              Developer tools — how extraction is performing
            </span>
          </Link>

          <form action={signOut}>
            <button
              type="submit"
              className="uc-focusable w-full rounded-[var(--uc-radius-control)] px-2 py-1.5 text-left text-sm hover:bg-[var(--uc-surface-muted)]"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
