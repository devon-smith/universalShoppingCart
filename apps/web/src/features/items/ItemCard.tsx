'use client';

import { availabilityLabel, discountPercent, formatMoney, relativeTime } from './format';
import { isAtOrBelowDesired } from './query';
import type { ItemStatus, SavedItem } from './query';

export const STATUS_LABELS: Record<ItemStatus, string> = {
  saved: 'Saved',
  cart: 'In cart',
  purchased: 'Purchased',
  archived: 'Archived',
};

/** The one status change that makes sense from a card, given where the item is now. */
const NEXT_STATUS: Partial<Record<ItemStatus, { to: ItemStatus; label: string }>> = {
  saved: { to: 'cart', label: 'Move to cart' },
  cart: { to: 'purchased', label: 'Mark purchased' },
  purchased: { to: 'saved', label: 'Move back to saved' },
};

export interface ItemCardProps {
  item: SavedItem;
  view: 'list' | 'cards';
  onOpen: (item: SavedItem) => void;
  onStatusChange: (item: SavedItem, status: ItemStatus) => void;
  onArchive: (item: SavedItem) => void;
  busy?: boolean;
}

/**
 * One saved product.
 *
 * Retailer text is rendered as text, never as markup. Missing values say so rather than
 * showing a blank — an unknown price is information; an empty space is a bug the user has
 * to guess at.
 */
export function ItemCard({ item, view, onOpen, onStatusChange, onArchive, busy }: ItemCardProps) {
  const price = formatMoney(item.current_price, item.currency);
  const original = formatMoney(item.original_price, item.currency);
  const discount = discountPercent(item.current_price, item.original_price);
  const variant = Object.entries(item.selected_variant ?? {});
  const next = NEXT_STATUS[item.status];
  const hitTarget = isAtOrBelowDesired(item);

  return (
    <li
      data-testid="item-card"
      data-item-id={item.id}
      data-status={item.status}
      className={[
        'rounded-lg border border-[var(--color-line)] p-4 transition-opacity',
        view === 'cards' ? 'flex flex-col gap-3' : 'flex gap-4',
        busy ? 'opacity-60' : '',
      ].join(' ')}
    >
      {item.image_url ? (
        // A plain <img>, not next/image: optimizing a retailer CDN image would mean either
        // allow-listing every retailer host or proxying arbitrary URLs, and an open image
        // proxy is an SSRF surface (BUILD_PLAN.md §17.4).
        <img
          src={item.image_url}
          alt=""
          className={
            view === 'cards'
              ? 'h-40 w-full rounded-md border border-[var(--color-line)] bg-white object-contain'
              : 'h-20 w-20 shrink-0 rounded-md border border-[var(--color-line)] bg-white object-contain'
          }
        />
      ) : (
        <div
          className={[
            'flex items-center justify-center rounded-md border border-dashed border-[var(--color-line)] text-xs text-[var(--color-ink-muted)]',
            view === 'cards' ? 'h-40 w-full' : 'h-20 w-20 shrink-0',
          ].join(' ')}
        >
          No image
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm font-medium hover:underline"
          >
            {item.title}
          </a>
          <span className="shrink-0 rounded-full border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">
            {STATUS_LABELS[item.status]}
          </span>
        </div>

        <p className="text-xs text-[var(--color-ink-muted)]">
          {item.brand ? `${item.brand} · ` : ''}
          {item.retailer_name}
        </p>

        <p className="flex flex-wrap items-baseline gap-2 text-sm">
          {price ? (
            <span className="font-semibold">{price}</span>
          ) : (
            <span className="text-[var(--color-ink-muted)]">Price unknown</span>
          )}
          {original && discount !== null ? (
            <>
              <span className="text-xs text-[var(--color-ink-muted)] line-through">{original}</span>
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                −{discount}%
              </span>
            </>
          ) : null}
          {item.quantity > 1 ? (
            <span className="text-xs text-[var(--color-ink-muted)]">×{item.quantity}</span>
          ) : null}
          {item.priority !== 'normal' ? (
            <span className="text-xs text-[var(--color-ink-muted)]">{item.priority} priority</span>
          ) : null}
        </p>

        {hitTarget ? (
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            At or below your target of {formatMoney(item.desired_price, item.currency)}
          </p>
        ) : null}

        {variant.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Selected options">
            {variant.map(([name, value]) => (
              <li
                key={name}
                className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]"
              >
                {name}: {value}
              </li>
            ))}
          </ul>
        ) : null}

        {item.note ? (
          <p className="text-xs text-[var(--color-ink-muted)] italic">{item.note}</p>
        ) : null}

        <p className="text-xs text-[var(--color-ink-muted)]">
          {availabilityLabel(item.availability)} · checked {relativeTime(item.last_observed_at)}
        </p>

        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
            onClick={() => onOpen(item)}
          >
            Details
          </button>
          {next ? (
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
              onClick={() => onStatusChange(item, next.to)}
            >
              {next.label}
            </button>
          ) : null}
          {item.status === 'archived' ? (
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
              onClick={() => onStatusChange(item, 'saved')}
            >
              Restore
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
              onClick={() => onArchive(item)}
            >
              Archive
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
