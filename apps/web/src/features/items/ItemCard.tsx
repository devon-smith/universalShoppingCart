import { availabilityLabel, discountPercent, formatMoney, relativeTime } from './format';

export interface SavedItemSummary {
  id: string;
  title: string;
  brand: string | null;
  retailer_name: string;
  source_url: string;
  image_url: string | null;
  currency: string | null;
  current_price: string | number | null;
  original_price: string | number | null;
  availability: string;
  selected_variant: Record<string, string> | null;
  note: string | null;
  quantity: number;
  status: string;
  last_observed_at: string | null;
}

/**
 * One saved product.
 *
 * Retailer-provided text is rendered as text, never as markup. Missing fields say so
 * rather than showing a blank — an unknown price is information, an empty space is not.
 */
export function ItemCard({ item }: { item: SavedItemSummary }) {
  const price = formatMoney(item.current_price, item.currency);
  const original = formatMoney(item.original_price, item.currency);
  const discount = discountPercent(item.current_price, item.original_price);
  const variant = Object.entries(item.selected_variant ?? {});

  return (
    <li className="flex gap-4 rounded-lg border border-[var(--color-line)] p-4">
      {item.image_url ? (
        // A plain <img>, not next/image: optimizing a retailer CDN image would mean
        // either allow-listing every retailer host or proxying arbitrary URLs, and an
        // open image proxy is an SSRF surface (BUILD_PLAN.md §17.4).
        <img
          src={item.image_url}
          alt=""
          className="h-20 w-20 shrink-0 rounded-md border border-[var(--color-line)] bg-white object-contain"
        />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--color-line)] text-xs text-[var(--color-ink-muted)]">
          No image
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <a
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-sm font-medium hover:underline"
        >
          {item.title}
        </a>

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
        </p>

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
          <p className="text-xs italic text-[var(--color-ink-muted)]">{item.note}</p>
        ) : null}

        <p className="text-xs text-[var(--color-ink-muted)]">
          {availabilityLabel(item.availability)} · checked {relativeTime(item.last_observed_at)}
        </p>
      </div>
    </li>
  );
}
