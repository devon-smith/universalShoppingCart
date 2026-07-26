'use client';

import { useEffect, useRef, useState } from 'react';

import type { ItemEdit } from './edits';
import { parseItemEditForm } from './edits';
import { availabilityLabel, discountPercent, formatMoney, relativeTime } from './format';
import { STATUS_LABELS } from './ItemCard';
import type { SavedItem } from './query';

export interface ItemDetailProps {
  item: SavedItem;
  onClose: () => void;
  onSave: (item: SavedItem, edit: ItemEdit) => Promise<void>;
  onDelete: (item: SavedItem) => Promise<void>;
}

/**
 * The item detail drawer.
 *
 * Editable fields are exactly the user-authored ones. Everything the retailer said is
 * shown read-only, with its provenance — this is where a user finds out *why* a price
 * looks wrong, rather than being tempted to "fix" it and lose the observation.
 */
export function ItemDetail({ item, onClose, onSave, onDelete }: ItemDetailProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const price = formatMoney(item.current_price, item.currency);
  const original = formatMoney(item.original_price, item.currency);
  const discount = discountPercent(item.current_price, item.original_price);
  const variant = Object.entries(item.selected_variant ?? {});
  const identifiers = Object.entries(item.identifiers ?? {});

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${item.title}`}
        tabIndex={-1}
        className="flex h-full w-full max-w-md flex-col gap-5 overflow-y-auto bg-[var(--color-surface)] p-6 shadow-xl outline-none dark:bg-[#0d1015]"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{item.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
          >
            Close
          </button>
        </header>

        <section aria-labelledby="observed-heading" className="flex flex-col gap-2">
          <h3 id="observed-heading" className="text-xs font-semibold uppercase tracking-wide">
            What the retailer says
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-[var(--color-ink-muted)]">Price</dt>
            <dd>
              {price ?? 'Unknown'}
              {original && discount !== null ? ` (was ${original}, −${discount}%)` : ''}
            </dd>

            <dt className="text-[var(--color-ink-muted)]">Availability</dt>
            <dd>{availabilityLabel(item.availability)}</dd>

            <dt className="text-[var(--color-ink-muted)]">Retailer</dt>
            <dd>{item.retailer_name}</dd>

            {item.brand ? (
              <>
                <dt className="text-[var(--color-ink-muted)]">Brand</dt>
                <dd>{item.brand}</dd>
              </>
            ) : null}

            {variant.length > 0 ? (
              <>
                <dt className="text-[var(--color-ink-muted)]">Variant</dt>
                <dd>{variant.map(([name, value]) => `${name}: ${value}`).join(' · ')}</dd>
              </>
            ) : null}

            <dt className="text-[var(--color-ink-muted)]">Last checked</dt>
            <dd>{relativeTime(item.last_observed_at)}</dd>
          </dl>

          <p className="text-xs text-[var(--color-ink-muted)]">
            These come from the page and are refreshed when you capture it again. They cannot be
            edited here — a correction would erase what was actually observed.
          </p>

          <div className="flex flex-wrap gap-2 text-xs">
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[var(--color-line)] px-2.5 py-1 hover:bg-[var(--color-surface-muted)]"
            >
              Open at retailer
            </a>
          </div>
        </section>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseItemEditForm(new FormData(event.currentTarget));

            if (!parsed.ok || !parsed.edit) {
              setErrors(parsed.errors ?? {});
              return;
            }

            setErrors({});
            setSaving(true);
            void onSave(item, parsed.edit).finally(() => setSaving(false));
          }}
        >
          <h3 className="text-xs font-semibold tracking-wide uppercase">Yours</h3>

          <label className="flex flex-col gap-1 text-sm" htmlFor="detail-status">
            Status
            <select
              id="detail-status"
              name="status"
              defaultValue={item.status}
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
            >
              {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="detail-quantity">
            Quantity
            <input
              id="detail-quantity"
              name="quantity"
              inputMode="numeric"
              defaultValue={item.quantity}
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
            />
            {errors.quantity ? (
              <span role="alert" className="text-xs text-red-700 dark:text-red-300">
                {errors.quantity}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="detail-priority">
            Priority
            <select
              id="detail-priority"
              name="priority"
              defaultValue={item.priority}
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="detail-desired">
            Desired price
            <input
              id="detail-desired"
              name="desiredPrice"
              inputMode="decimal"
              placeholder="79.99"
              defaultValue={item.desired_price === null ? '' : String(item.desired_price)}
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
            />
            {errors.desiredPrice ? (
              <span role="alert" className="text-xs text-red-700 dark:text-red-300">
                {errors.desiredPrice}
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1 text-sm" htmlFor="detail-note">
            Note
            <textarea
              id="detail-note"
              name="note"
              rows={3}
              defaultValue={item.note ?? ''}
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
            />
            {errors.note ? (
              <span role="alert" className="text-xs text-red-700 dark:text-red-300">
                {errors.note}
              </span>
            ) : null}
          </label>

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>

        <section aria-labelledby="diagnostics-heading" className="flex flex-col gap-1">
          <h3
            id="diagnostics-heading"
            className="text-xs font-semibold tracking-wide uppercase text-[var(--color-ink-muted)]"
          >
            Diagnostics
          </h3>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {identifiers.length > 0
              ? identifiers.map(([kind, value]) => `${kind}: ${value}`).join(' · ')
              : 'No product identifiers were found on the page.'}
          </p>
        </section>

        <section className="mt-auto flex flex-col gap-2 border-t border-[var(--color-line)] pt-4">
          {confirmingDelete ? (
            <>
              <p className="text-sm">
                Delete this item and its price history permanently? Archiving keeps both and can be
                undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-red-400 px-3 py-1.5 text-sm text-red-700 dark:text-red-300"
                  onClick={() => void onDelete(item)}
                >
                  Yes, delete it
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep it
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="self-start text-xs text-[var(--color-ink-muted)] underline"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete permanently
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
