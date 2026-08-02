'use client';

import { Price, StatusBadge } from '@universal-cart/ui';
import { useRef, useState } from 'react';

import { useDismissable, useReturnFocus } from '@/features/shell/useDismissable';

import { displayTitle, sourceLine } from './display';
import { availabilityLabel, formatMoney, relativeTime } from './format';
import { freshness, priceChange } from './freshness';
import type { ItemStatus, PriceSummary, SavedItem } from './query';
import { isAtOrBelowDesired } from './query';

export const STATUS_LABELS: Record<ItemStatus, string> = {
  saved: 'Saved',
  cart: 'In cart',
  purchased: 'Purchased',
  archived: 'Archived',
};

/** The one status change that makes sense from a card, given where the item is now. */
export const NEXT_STATUS: Partial<Record<ItemStatus, { to: ItemStatus; label: string }>> = {
  saved: { to: 'cart', label: 'Move to cart' },
  cart: { to: 'purchased', label: 'Mark purchased' },
  purchased: { to: 'saved', label: 'Move back to saved' },
};

/**
 * The product's name, as we choose to show it.
 *
 * `displayTitle` trims page-title furniture at the display layer only — the stored title is
 * still exactly what the page said, and the extractor is untouched.
 */
export function ItemTitle({ item, className }: { item: SavedItem; className?: string }) {
  return (
    <a
      href={item.source_url}
      target="_blank"
      rel="noreferrer"
      className={['uc-focusable rounded-sm hover:underline', className].filter(Boolean).join(' ')}
    >
      {displayTitle(item.title, item.retailer_name, item.domain)}
    </a>
  );
}

/** Who is selling it. One line, and the same fact never printed twice. */
export function ItemSource({ item }: { item: SavedItem }) {
  return (
    <p className="truncate text-xs text-[var(--uc-foreground-muted)]">
      {sourceLine(item.brand, item.retailer_name).text}
    </p>
  );
}

/**
 * The price, through the one primitive allowed to render money.
 *
 * `Price` is what makes a range structurally incapable of reading as a discount and drops a
 * list price that is not strictly higher, so no caller can invent a saving by passing the
 * wrong pair of numbers.
 */
export function ItemPrice({ item, size = 'md' }: { item: SavedItem; size?: 'md' | 'lg' }) {
  const current = item.current_price === null ? null : String(item.current_price);
  const original = item.original_price === null ? null : String(item.original_price);

  return (
    <Price
      size={size}
      cadence="one_time"
      value={current === null ? null : { amount: current, currency: item.currency }}
      listPrice={original === null ? null : { amount: original, currency: item.currency }}
      unknownLabel="Price unknown"
    />
  );
}

/**
 * An observed price movement.
 *
 * Rendered only when two observations exist and disagree — `priceChange` returns `unknown`
 * otherwise. The arrow and the words carry the meaning; colour agrees with them but is never
 * the only signal (WCAG 1.4.1).
 */
export function ItemPriceChange({
  item,
  summary,
}: {
  item: SavedItem;
  summary?: PriceSummary | undefined;
}) {
  const change = priceChange(item.current_price, summary?.previous_price ?? null);
  if (change.direction !== 'down' && change.direction !== 'up') return null;

  const fell = change.direction === 'down';

  return (
    <p
      data-testid="price-change"
      data-direction={change.direction}
      className="flex flex-wrap items-center gap-1.5 text-xs"
    >
      <StatusBadge tone={fell ? 'success' : 'neutral'}>
        <span aria-hidden="true">{fell ? '▼' : '▲'}</span>{' '}
        {formatMoney(change.amount, item.currency) ?? change.amount}
        {change.percent !== null ? ` (${change.percent}%)` : ''}
      </StatusBadge>
      <span className="text-[var(--uc-foreground-muted)]">
        {fell ? 'cheaper' : 'dearer'} than when you saved it
      </span>
    </p>
  );
}

/**
 * Availability and how old the observation is.
 *
 * Unknown availability says so. It is the honest answer on seven of sixteen live pages, and
 * defaulting it to "in stock" would be the single most damaging lie this product could tell.
 */
export function ItemFreshness({ item }: { item: SavedItem }) {
  const age = freshness(item.last_observed_at);
  const stale = age.level === 'stale' || age.level === 'never';

  return (
    <p
      data-testid="freshness"
      data-level={age.level}
      className={[
        'flex flex-wrap items-center gap-1.5 text-xs',
        stale ? 'text-[var(--uc-warning)]' : 'text-[var(--uc-foreground-muted)]',
      ].join(' ')}
    >
      {stale ? <span aria-hidden="true">⚠</span> : null}
      {/* The separator belongs to the label before it. As its own flex item it could wrap
          onto a line of its own — which is what the 768 and 1024 rows did, leaving a lone
          "·" above "checked 3d ago" and reading as a rendering fault. */}
      <span>
        {availabilityLabel(item.availability)}
        <span aria-hidden="true"> ·</span>
      </span>
      <span>{stale ? age.label : `checked ${relativeTime(item.last_observed_at)}`}</span>
    </p>
  );
}

/** The size and colour the user picked, as chips. */
export function ItemVariant({ item }: { item: SavedItem }) {
  const variant = Object.entries(item.selected_variant ?? {});
  if (variant.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1" aria-label="Selected options">
      {variant.map(([name, value]) => (
        <li
          key={name}
          className="rounded-[var(--uc-radius-pill)] border border-[var(--uc-border)] px-2 py-0.5 text-xs text-[var(--uc-foreground-muted)]"
        >
          {name}: {value}
        </li>
      ))}
    </ul>
  );
}

/** Quantity, priority and target — the user's own annotations, never the retailer's. */
export function ItemAnnotations({ item }: { item: SavedItem }) {
  const hitTarget = isAtOrBelowDesired(item);

  return (
    <>
      {item.quantity > 1 || item.priority !== 'normal' || hitTarget ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[var(--uc-foreground-muted)]">
          {item.quantity > 1 ? <span>×{item.quantity}</span> : null}
          {item.priority !== 'normal' ? <span>{item.priority} priority</span> : null}
          {hitTarget ? (
            <StatusBadge tone="success">
              At or below your target of {formatMoney(item.desired_price, item.currency)}
            </StatusBadge>
          ) : null}
        </p>
      ) : null}
      {item.note ? (
        <p className="line-clamp-2 text-xs text-[var(--uc-foreground-muted)] italic">{item.note}</p>
      ) : null}
    </>
  );
}

/**
 * Actions on one item.
 *
 * Details and the one sensible status change stay visible — those are what a person does
 * daily. Archive and "open at retailer" move into an overflow menu: at 375px four buttons wrap
 * into a second row, and putting a destructive-ish action a thumb's width from the primary one
 * is how a saved product gets lost to a mis-tap.
 */
export function ItemActions({
  item,
  busy,
  onOpen,
  onStatusChange,
  onArchive,
}: {
  item: SavedItem;
  busy?: boolean;
  onOpen: (item: SavedItem) => void;
  onStatusChange: (item: SavedItem, status: ItemStatus) => void;
  onArchive: (item: SavedItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useDismissable(open, container, () => setOpen(false));
  useReturnFocus(open, trigger);

  const next = NEXT_STATUS[item.status];
  const name = displayTitle(item.title, item.retailer_name, item.domain);
  const panelId = `item-actions-${item.id}`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        className="uc-button uc-button--secondary uc-focusable"
        onClick={() => onOpen(item)}
      >
        Details
      </button>

      {item.status === 'archived' ? (
        <button
          type="button"
          disabled={busy}
          className="uc-button uc-button--secondary uc-focusable"
          onClick={() => onStatusChange(item, 'saved')}
        >
          Restore
        </button>
      ) : next ? (
        <button
          type="button"
          disabled={busy}
          className="uc-button uc-button--secondary uc-focusable"
          onClick={() => onStatusChange(item, next.to)}
        >
          {next.label}
        </button>
      ) : null}

      <div className="relative" ref={container}>
        <button
          type="button"
          ref={trigger}
          className="uc-icon-button uc-focusable"
          aria-label={`More actions for ${name}`}
          aria-expanded={open}
          // No `aria-haspopup` — see AccountMenu. Announcing a menu and then rendering
          // ordinary buttons is a promise of keyboard behaviour that is not kept.
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">⋯</span>
        </button>

        {/* Ordinary controls, not `role="menu"` — see AccountMenu for why. Named for the item
            it acts on, so a screen reader user who opens two of these can tell them apart. */}
        {open ? (
          <div
            id={panelId}
            role="group"
            aria-label={`Actions for ${name}`}
            className="uc-surface uc-surface--overlay absolute right-0 z-20 mt-1 flex w-48 flex-col gap-0.5 p-1.5"
          >
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
              className="uc-focusable rounded-[var(--uc-radius-control)] px-2 py-1.5 text-sm hover:bg-[var(--uc-surface-muted)]"
              onClick={() => setOpen(false)}
            >
              Open at {item.retailer_name}
            </a>
            {item.status === 'archived' ? null : (
              <button
                type="button"
                disabled={busy}
                className="uc-focusable rounded-[var(--uc-radius-control)] px-2 py-1.5 text-left text-sm hover:bg-[var(--uc-surface-muted)]"
                onClick={() => {
                  setOpen(false);
                  onArchive(item);
                }}
              >
                Archive
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
