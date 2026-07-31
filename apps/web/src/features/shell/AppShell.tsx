'use client';

import { useRef, useState, type ReactNode } from 'react';

import type { SectionId } from '@/features/items/sections';
import { SECTIONS } from '@/features/items/sections';

import { AccountMenu } from './AccountMenu';
import { useDismissable, useFocusTrap } from './useDismissable';

export interface ShellCart {
  id: string;
  name: string;
  is_default: boolean;
}

/**
 * The dashboard's chrome.
 *
 * One navigation, rendered twice: a permanent rail from `lg` up, and a drawer below it. The
 * alternative — a bottom tab bar on mobile — was rejected because the nav has to hold the cart
 * selector and the account menu as well as four sections, and a five-item tab bar with a
 * "more" pile is the shape that makes people stop finding things.
 *
 * Search sits in the content column rather than the rail. It acts on the section you are
 * looking at, and putting it next to the results is what makes that legible.
 */
export function AppShell({
  carts,
  cartId,
  onCartChange,
  section,
  onSectionChange,
  counts,
  email,
  signOut,
  search,
  onSearchChange,
  children,
}: {
  carts: ShellCart[];
  cartId: string;
  onCartChange: (id: string) => void;
  section: SectionId;
  onSectionChange: (section: SectionId) => void;
  counts: Record<SectionId, number>;
  email: string;
  signOut: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);

  useDismissable(drawerOpen, drawer, () => setDrawerOpen(false));
  useFocusTrap(drawerOpen, drawer);

  /** A drawer that survived the navigation it performed would cover what it navigated to. */
  function goToSection(next: SectionId) {
    setDrawerOpen(false);
    onSectionChange(next);
  }

  const nav = (
    <nav aria-label="Sections" className="flex flex-col gap-0.5">
      {SECTIONS.map((entry) => {
        const active = entry.id === section;
        return (
          <button
            key={entry.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={() => goToSection(entry.id)}
            className={[
              'uc-focusable flex items-center justify-between gap-2 rounded-[var(--uc-radius-control)] px-2.5 py-2 text-left text-sm',
              active
                ? 'bg-[var(--uc-surface-muted)] font-semibold text-[var(--uc-foreground)]'
                : 'text-[var(--uc-foreground-muted)] hover:bg-[var(--uc-surface-muted)]',
            ].join(' ')}
          >
            <span className="truncate">{entry.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-[var(--uc-foreground-muted)]">
              {counts[entry.id]}
            </span>
          </button>
        );
      })}
    </nav>
  );

  /**
   * The nav is rendered twice — the rail stays in the DOM behind the drawer — so the control
   * needs a distinct id per copy. Two elements sharing one id is not a styling detail: it
   * silently breaks `htmlFor`, and a screen reader then announces the wrong label.
   */
  const cartSelector = (place: 'rail' | 'drawer') =>
    carts.length > 0 ? (
      <div className="flex flex-col gap-1">
        <label
          className="px-1 text-[0.6875rem] font-semibold tracking-[0.06em] text-[var(--uc-foreground-muted)] uppercase"
          htmlFor={`shell-cart-${place}`}
        >
          Cart
        </label>
        <select
          id={`shell-cart-${place}`}
          className="uc-input uc-focusable text-sm"
          value={cartId}
          onChange={(event) => onCartChange(event.target.value)}
        >
          {carts.map((cart) => (
            <option key={cart.id} value={cart.id}>
              {cart.name}
              {cart.is_default ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  const railContents = (
    <>
      <p className="uc-wordmark px-1 text-lg tracking-tight">Universal Cart</p>
      {cartSelector('rail')}
      {nav}
      <div className="mt-auto border-t border-[var(--uc-border)] pt-2">
        <AccountMenu email={email} signOut={signOut} />
      </div>
    </>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop rail. */}
      <aside className="hidden w-60 shrink-0 flex-col gap-4 border-r border-[var(--uc-border)] bg-[var(--uc-surface)] p-4 lg:sticky lg:top-0 lg:flex lg:h-screen">
        {railContents}
      </aside>

      {/* Mobile bar. */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--uc-border)] bg-[var(--uc-surface)] px-4 py-2.5 lg:hidden">
        <button
          type="button"
          className="uc-icon-button uc-focusable"
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
            <path d="M4 7h16M4 12h16M4 17h16" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <p className="uc-wordmark text-base tracking-tight">Universal Cart</p>
      </header>

      {drawerOpen ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div aria-hidden="true" className="absolute inset-0 bg-black/40" />
          <div
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 border-r border-[var(--uc-border)] bg-[var(--uc-surface)] p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="uc-wordmark text-lg tracking-tight">Universal Cart</p>
              <button
                type="button"
                className="uc-icon-button uc-focusable"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
                  <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {cartSelector('drawer')}
            {nav}
            <div className="mt-auto border-t border-[var(--uc-border)] pt-2">
              <AccountMenu email={email} signOut={signOut} />
            </div>
          </div>
        </div>
      ) : null}

      <main className="min-w-0 flex-1">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
          <div className="flex flex-col gap-1">
            <label className="sr-only" htmlFor="search">
              Search saved products
            </label>
            <input
              id="search"
              type="search"
              placeholder="Search your saved products"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="uc-input uc-focusable w-full"
            />
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
