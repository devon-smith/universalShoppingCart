'use client';

import { Button } from '@universal-cart/ui';
import Link from 'next/link';

import { MAX_COMPARE_ITEMS, MIN_COMPARE_ITEMS } from './compare';
import { compareHref } from './selection';

export interface TrayItem {
  id: string;
  title: string;
}

/**
 * The compare tray.
 *
 * BUILD_PLAN.md §12.6 asks for a "quick compare tray that stays visible while browsing the
 * dashboard", and that phrasing is the design: choosing what to compare is something you do
 * *while* scrolling, filtering and searching, so the tray follows you rather than living at
 * the bottom of the list.
 *
 * It appears on the first selection and not before — an empty bar permanently occupying the
 * bottom of the screen is a control that costs space every day to be useful occasionally. It
 * says what is selected by name, because "3 selected" leaves you scrolling back to check.
 *
 * With one item chosen it explains what is missing instead of offering a dead button:
 * `compareHref` returns null below two, so there is nothing to click and nothing pretending
 * otherwise.
 */
export function CompareTray({
  items,
  onRemove,
  onClear,
}: {
  items: TrayItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;

  const href = compareHref(items.map((item) => item.id));
  const full = items.length >= MAX_COMPARE_ITEMS;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4"
      data-testid="compare-tray"
    >
      <div className="uc-surface uc-surface--overlay pointer-events-auto flex w-full max-w-3xl flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            Comparing {items.length} of {MAX_COMPARE_ITEMS}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="ghost" onClick={onClear}>
              Clear
            </Button>
            {href ? (
              <Link
                href={href}
                data-testid="compare-open"
                className="uc-button uc-button--primary uc-focusable"
              >
                Compare {items.length}
              </Link>
            ) : (
              /* Not a disabled button: a control that looks pressable and is not invites the
                 click that does nothing. The sentence says what to do instead. */
              <span className="text-sm text-[var(--uc-foreground-muted)]">
                Pick {MIN_COMPARE_ITEMS - items.length} more to compare
              </span>
            )}
          </div>
        </div>

        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="uc-focusable flex max-w-56 items-center gap-1.5 rounded-[var(--uc-radius-pill)] border border-[var(--uc-border-strong)] px-2.5 py-1 text-xs"
              >
                <span className="truncate">{item.title}</span>
                <span aria-hidden="true">×</span>
                <span className="uc-sr-only">Remove from comparison</span>
              </button>
            </li>
          ))}
        </ul>

        {full ? (
          <p className="text-xs text-[var(--uc-foreground-muted)]">
            Four is the most that stays readable side by side. Remove one to swap it.
          </p>
        ) : null}
      </div>
    </div>
  );
}
