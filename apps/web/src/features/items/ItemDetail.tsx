'use client';

import { Button, Callout, ProductImage } from '@universal-cart/ui';
import { useEffect, useRef, useState } from 'react';

import { useDismissable, useFocusTrap } from '@/features/shell/useDismissable';
import { getBrowserSupabase } from '@/lib/supabase/browser';

import { availabilitySplit } from './availability';
import type { ItemEdit } from './edits';
import { parseItemEditForm } from './edits';
import { decimalForInput, relativeTime } from './format';
import { freshness } from './freshness';
import type { Observation } from './history';
import { summarizeHistory } from './history';
import { ItemPrice, ItemSource, STATUS_LABELS } from './ItemFacts';
import { PriceHistory } from './PriceHistory';
import type { SavedItem } from './query';
import { TargetPrice } from './TargetPrice';

export interface ItemDetailProps {
  item: SavedItem;
  onClose: () => void;
  onSave: (item: SavedItem, edit: ItemEdit) => Promise<void>;
  onDelete: (item: SavedItem) => Promise<void>;
}

/**
 * The item detail drawer.
 *
 * A panel from the right on a wide screen, a full-height sheet on a narrow one — the same
 * content either way, because everything in here is a single column already.
 *
 * The **"What the retailer says" / "Yours"** split is the central idea of the product and the
 * only place it is stated outright: a retailer refresh must never overwrite a note or a target
 * (BUILD_PLAN.md §13.2). The redesign makes it louder rather than quieter — two headed
 * sections with different surfaces, each saying in a sentence what it is and why it behaves
 * the way it does.
 */
export function ItemDetail({ item, onClose, onSave, onDelete }: ItemDetailProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [imageUsable, setImageUsable] = useState(true);
  // Keyed by item id so switching items shows "loading" rather than the previous item's
  // history, without an effect that resets state on the way in.
  const [history, setHistory] = useState<{ itemId: string; observations: Observation[] } | null>(
    null,
  );
  const panel = useRef<HTMLDivElement>(null);

  useDismissable(true, panel, onClose);
  useFocusTrap(true, panel);

  useEffect(() => {
    let active = true;
    const itemId = item.id;

    // Money as text, so the history shows the exact decimals that were observed.
    getBrowserSupabase()
      .from('item_observations')
      .select('id, observed_at, price::text, currency, availability, source')
      .eq('item_id', itemId)
      .order('observed_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!active) return;
        setHistory({ itemId, observations: (data ?? []) as unknown as Observation[] });
      });

    return () => {
      active = false;
    };
  }, [item.id]);

  const loadingHistory = history?.itemId !== item.id;
  const observations = loadingHistory ? null : (history?.observations ?? null);
  const summary = summarizeHistory(observations ?? []);

  const variant = Object.entries(item.selected_variant ?? {});
  const identifiers = Object.entries(item.identifiers ?? {});
  const age = freshness(item.last_observed_at);
  const stale = age.level === 'stale' || age.level === 'never';
  const availability = availabilitySplit(item.availability, item.product_availability);
  const image = imageUsable ? item.image_url : null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${item.title}`}
        className="flex h-full w-full flex-col gap-5 overflow-y-auto bg-[var(--uc-background)] p-5 shadow-[var(--uc-shadow-overlay)] outline-none sm:max-w-lg sm:p-6"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <ItemSource item={item} />
            <h2 className="text-lg font-semibold tracking-tight">{item.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="uc-icon-button uc-focusable shrink-0"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor">
              <path d="M6 6l12 12M18 6L6 18" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {image ? (
          <ProductImage
            src={image}
            alt={item.title}
            className="w-full"
            onUnavailable={() => setImageUsable(false)}
          />
        ) : null}

        {/* ---------------- What the retailer says ---------------- */}
        <section
          aria-labelledby="observed-heading"
          className="uc-surface uc-surface--raised flex flex-col gap-3 p-4"
        >
          <div className="flex flex-col gap-1">
            <h3
              id="observed-heading"
              className="text-[0.6875rem] font-semibold tracking-[0.06em] uppercase"
            >
              What the retailer says
            </h3>
            <p className="text-xs text-[var(--uc-foreground-muted)]">
              Observed from the page. Not editable here — a correction would erase what was actually
              seen, and a refresh would overwrite it again anyway.
            </p>
          </div>

          <ItemPrice item={item} size="lg" />

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-[var(--uc-foreground-muted)]">Availability</dt>
            <dd>
              {availability.variant}
              {availability.product ? (
                <span className="text-[var(--uc-foreground-muted)]">
                  {' '}
                  (product: {availability.product})
                </span>
              ) : null}
            </dd>

            {variant.length > 0 ? (
              <>
                <dt className="text-[var(--uc-foreground-muted)]">Variant</dt>
                <dd>{variant.map(([name, value]) => `${name}: ${value}`).join(' · ')}</dd>
              </>
            ) : null}

            <dt className="text-[var(--uc-foreground-muted)]">Last observed</dt>
            <dd data-testid="detail-freshness" data-level={age.level}>
              {relativeTime(item.last_observed_at)}
            </dd>
          </dl>

          {/* Only when the page made two different claims — which is the only time the column
              is non-null, so this cannot fire on agreement. */}
          {availability.sentence ? (
            <Callout tone="warning" announce={false}>
              {availability.sentence}
            </Callout>
          ) : null}

          {stale ? (
            <Callout tone="warning" announce={false}>
              {age.label}. Open the page with the extension side panel to re-check it.
            </Callout>
          ) : null}

          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="uc-button uc-button--secondary uc-focusable self-start"
          >
            Open at {item.retailer_name}
          </a>
        </section>

        {/* ---------------- Yours ---------------- */}
        <form
          className="uc-surface uc-surface--raised flex flex-col gap-3 p-4"
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
          <div className="flex flex-col gap-1">
            <h3 className="text-[0.6875rem] font-semibold tracking-[0.06em] uppercase">Yours</h3>
            <p className="text-xs text-[var(--uc-foreground-muted)]">
              Yours alone. A price refresh never touches any of these.
            </p>
          </div>

          <TargetPrice item={item} summary={summary} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="uc-field">
              <label className="uc-field__label" htmlFor="detail-status">
                Status
              </label>
              <select
                id="detail-status"
                name="status"
                defaultValue={item.status}
                className="uc-input uc-focusable"
              >
                {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>

            <div className="uc-field">
              <label className="uc-field__label" htmlFor="detail-priority">
                Priority
              </label>
              <select
                id="detail-priority"
                name="priority"
                defaultValue={item.priority}
                className="uc-input uc-focusable"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>

            <div className="uc-field">
              <label className="uc-field__label" htmlFor="detail-quantity">
                Quantity
              </label>
              <input
                id="detail-quantity"
                name="quantity"
                inputMode="numeric"
                defaultValue={item.quantity}
                aria-invalid={errors.quantity ? true : undefined}
                className="uc-input uc-focusable"
              />
              {errors.quantity ? (
                <span role="alert" className="uc-field__message uc-field__message--error">
                  {errors.quantity}
                </span>
              ) : null}
            </div>

            <div className="uc-field">
              <label className="uc-field__label" htmlFor="detail-desired">
                Desired price
              </label>
              <input
                id="detail-desired"
                name="desiredPrice"
                inputMode="decimal"
                placeholder="79.99"
                defaultValue={decimalForInput(item.desired_price)}
                aria-invalid={errors.desiredPrice ? true : undefined}
                className="uc-input uc-focusable"
              />
              {errors.desiredPrice ? (
                <span role="alert" className="uc-field__message uc-field__message--error">
                  {errors.desiredPrice}
                </span>
              ) : null}
            </div>
          </div>

          <div className="uc-field">
            <label className="uc-field__label" htmlFor="detail-note">
              Note
            </label>
            <textarea
              id="detail-note"
              name="note"
              rows={3}
              defaultValue={item.note ?? ''}
              className="uc-input uc-focusable"
            />
            {errors.note ? (
              <span role="alert" className="uc-field__message uc-field__message--error">
                {errors.note}
              </span>
            ) : null}
          </div>

          <Button type="submit" tone="primary" disabled={saving} className="self-start">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </form>

        {/* ---------------- Price history ---------------- */}
        <section aria-labelledby="history-heading" className="flex flex-col gap-2">
          <h3
            id="history-heading"
            className="text-[0.6875rem] font-semibold tracking-[0.06em] uppercase"
          >
            Price history
          </h3>
          <PriceHistory
            observations={observations}
            loading={loadingHistory}
            currency={item.currency}
          />
        </section>

        {/* ---------------- Diagnostics ---------------- */}
        <details className="text-sm">
          <summary className="uc-focusable w-fit cursor-pointer rounded-[var(--uc-radius-control)] text-[var(--uc-primary)]">
            Where this came from
          </summary>

          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {/*
              Both URLs, labelled as what they are. The canonical one is the address the
              fingerprint is built from, and seeing it beside the source is the only way a
              tester can tell that a variant parameter survived canonicalisation — or was
              dropped. Lululemon's product id is a whole URL carrying `?color=76616`; whether
              that colour survives is exactly the `canonical` failure code in LIVE_TESTING.md,
              and it was unobservable while this row did not exist.
            */}
            <dt className="text-[var(--uc-foreground-muted)]">Page you saved from</dt>
            <dd className="break-all">{item.source_url}</dd>

            <dt className="text-[var(--uc-foreground-muted)]">Canonical address</dt>
            <dd className="break-all">
              {item.canonical_url ?? (
                <span className="text-[var(--uc-foreground-muted)]">
                  The page did not declare one
                </span>
              )}
            </dd>

            <dt className="text-[var(--uc-foreground-muted)]">Product codes</dt>
            <dd className="break-all">
              {identifiers.length > 0
                ? identifiers.map(([kind, value]) => `${kind}: ${value}`).join(' · ')
                : 'None published on the page'}
            </dd>
          </dl>

          <p className="mt-2 text-xs text-[var(--uc-foreground-muted)]">
            Universal Cart matches a product by its canonical address and the options you picked. If
            the same item saves twice, these are the values to compare.
          </p>
        </details>

        {/* ---------------- Destructive ---------------- */}
        <section
          aria-labelledby="danger-heading"
          className="mt-auto flex flex-col gap-2 rounded-[var(--uc-radius-surface)] border border-[var(--uc-danger)] p-4"
        >
          <h3
            id="danger-heading"
            className="text-[0.6875rem] font-semibold tracking-[0.06em] text-[var(--uc-danger)] uppercase"
          >
            Permanent
          </h3>

          {confirmingDelete ? (
            <>
              <p className="text-sm">
                Delete this item and its price history permanently? Archiving keeps both and can be
                undone.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button tone="danger" onClick={() => void onDelete(item)}>
                  Yes, delete it
                </Button>
                <Button onClick={() => setConfirmingDelete(false)}>Keep it</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--uc-foreground-muted)]">
                Deleting removes the item and every observation recorded for it. There is no undo.
              </p>
              <Button tone="ghost" className="self-start" onClick={() => setConfirmingDelete(true)}>
                Delete permanently
              </Button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
