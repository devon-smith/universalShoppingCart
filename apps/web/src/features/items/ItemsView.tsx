'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

import { archiveItem, deleteItem, setItemStatus, updateItem } from './actions';
import type { ItemEdit } from './edits';
import { ItemCard, STATUS_LABELS } from './ItemCard';
import { ItemDetail } from './ItemDetail';
import type {
  ItemAvailability,
  ItemFilters,
  ItemStatus,
  PriceSummary,
  SavedItem,
  SortKey,
} from './query';
import { applyQuery, EMPTY_FILTERS, hasActiveFilters, retailerOptions } from './query';
import { applyRealtimeUpsert, removeItem, replaceItem, withEdit } from './reduce';
import { useItemsRealtime } from './useItemsRealtime';

type View = 'list' | 'cards';

interface Undo {
  message: string;
  run: () => Promise<void>;
}

const SORT_LABELS: Record<SortKey, string> = {
  'recently-updated': 'Recently updated',
  'recently-added': 'Recently added',
  'price-low': 'Price: low to high',
  'price-high': 'Price: high to low',
  priority: 'Priority',
  title: 'Title',
};

const AVAILABILITY_OPTIONS: ItemAvailability[] = [
  'in_stock',
  'out_of_stock',
  'preorder',
  'backorder',
  'unknown',
];

/**
 * The dashboard.
 *
 * Every mutation is applied locally first and rolled back if the server rejects it, so the
 * list never freezes while a write is in flight. Archive and delete both offer an undo,
 * because losing a saved product to a mis-click is the failure that would make someone stop
 * trusting the app.
 */
export function ItemsView({
  initialItems,
  priceSummaries,
  cartIds,
}: {
  initialItems: SavedItem[];
  priceSummaries: PriceSummary[];
  cartIds: string[];
}) {
  const [items, setItems] = useState(initialItems);
  const [filters, setFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('recently-updated');
  const [view, setView] = useState<View>('list');
  const [openItem, setOpenItem] = useState<SavedItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onRealtimeChange = useCallback(
    (change: Parameters<Parameters<typeof useItemsRealtime>[1]>[0]) => {
      setItems((current) =>
        change.type === 'delete'
          ? removeItem(current, change.id)
          : applyRealtimeUpsert(current, change.item, cartIds),
      );
    },
    [cartIds],
  );

  useItemsRealtime(cartIds, onRealtimeChange);

  const visible = useMemo(() => applyQuery(items, filters, sort), [items, filters, sort]);
  const retailers = useMemo(() => retailerOptions(items), [items]);
  const summaries = useMemo(
    () => new Map(priceSummaries.map((summary) => [summary.item_id, summary])),
    [priceSummaries],
  );

  function offerUndo(message: string, run: () => Promise<void>) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ message, run });
    undoTimer.current = setTimeout(() => setUndo(null), 10_000);
  }

  async function withBusy(id: string, work: () => Promise<void>) {
    setBusyIds((current) => new Set(current).add(id));
    try {
      await work();
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  /** Apply locally, call the server, and put the previous value back if it refuses. */
  async function optimistic(
    item: SavedItem,
    apply: (current: SavedItem) => SavedItem,
    call: () => Promise<{ ok: boolean; error?: string }>,
  ): Promise<boolean> {
    const previous = item;
    setError(null);
    setItems((current) => replaceItem(current, item.id, apply));

    let succeeded = false;
    await withBusy(item.id, async () => {
      const result = await call();
      if (result.ok) {
        succeeded = true;
        return;
      }

      setItems((current) => replaceItem(current, previous.id, () => previous));
      setError(result.error ?? 'That change could not be saved.');
    });

    return succeeded;
  }

  async function changeStatus(item: SavedItem, status: ItemStatus) {
    await optimistic(
      item,
      (current) => ({ ...current, status }),
      () => setItemStatus(item.id, status),
    );
  }

  async function archive(item: SavedItem) {
    const restored = item.status;
    const ok = await optimistic(
      item,
      (current) => ({ ...current, status: 'archived' as const }),
      () => archiveItem(item.id),
    );

    if (ok) {
      offerUndo(`Archived “${item.title}”.`, async () => {
        await optimistic(
          { ...item, status: 'archived' },
          (current) => ({ ...current, status: restored }),
          () => setItemStatus(item.id, restored),
        );
        setUndo(null);
      });
    }
  }

  async function save(item: SavedItem, edit: ItemEdit) {
    const ok = await optimistic(
      item,
      (current) => withEdit(current, edit),
      () => updateItem(item.id, edit),
    );

    if (ok) setOpenItem(null);
  }

  async function remove(item: SavedItem) {
    const previous = items;
    setItems((current) => removeItem(current, item.id));
    setOpenItem(null);

    const result = await deleteItem(item.id);
    if (!result.ok) {
      setItems(previous);
      setError(result.error ?? 'That item could not be deleted.');
    }
  }

  const showingArchived = filters.statuses.includes('archived');

  return (
    <section aria-labelledby="items-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="items-heading" className="text-sm font-semibold">
          Saved products{' '}
          <span className="font-normal text-[var(--color-ink-muted)]">
            ({visible.length}
            {visible.length !== items.length ? ` of ${items.length}` : ''})
          </span>
        </h2>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="sort">
            Sort by
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="rounded-md border border-[var(--color-line)] px-2 py-1 text-xs"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>

          <div
            className="flex rounded-md border border-[var(--color-line)]"
            role="group"
            aria-label="View"
          >
            {(['list', 'cards'] as View[]).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={[
                  'px-2.5 py-1 text-xs capitalize',
                  view === option ? 'bg-[var(--color-surface-muted)] font-medium' : '',
                ].join(' ')}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="search">
          Search saved products
        </label>
        <input
          id="search"
          type="search"
          placeholder="Search title, brand, retailer, note, variant"
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          className="min-w-56 flex-1 rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm"
        />

        <label className="sr-only" htmlFor="filter-status">
          Status
        </label>
        <select
          id="filter-status"
          value={filters.statuses[0] ?? ''}
          onChange={(event) =>
            setFilters({
              ...filters,
              statuses: event.target.value ? [event.target.value as ItemStatus] : [],
            })
          }
          className="rounded-md border border-[var(--color-line)] px-2 py-1.5 text-xs"
        >
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-retailer">
          Retailer
        </label>
        <select
          id="filter-retailer"
          value={filters.retailers[0] ?? ''}
          onChange={(event) =>
            setFilters({ ...filters, retailers: event.target.value ? [event.target.value] : [] })
          }
          className="rounded-md border border-[var(--color-line)] px-2 py-1.5 text-xs"
        >
          <option value="">Any retailer</option>
          {retailers.map((retailer) => (
            <option key={retailer} value={retailer}>
              {retailer}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-availability">
          Availability
        </label>
        <select
          id="filter-availability"
          value={filters.availabilities[0] ?? ''}
          onChange={(event) =>
            setFilters({
              ...filters,
              availabilities: event.target.value ? [event.target.value as ItemAvailability] : [],
            })
          }
          className="rounded-md border border-[var(--color-line)] px-2 py-1.5 text-xs"
        >
          <option value="">Any availability</option>
          {AVAILABILITY_OPTIONS.map((availability) => (
            <option key={availability} value={availability}>
              {availability.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={filters.onSaleOnly}
            onChange={(event) => setFilters({ ...filters, onSaleOnly: event.target.checked })}
          />
          On sale
        </label>

        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={filters.atOrBelowDesiredOnly}
            onChange={(event) =>
              setFilters({ ...filters, atOrBelowDesiredOnly: event.target.checked })
            }
          />
          Hit my target
        </label>

        {hasActiveFilters(filters) ? (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="rounded-md border border-[var(--color-line)] px-2.5 py-1 text-xs"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--color-line)] px-4 py-6">
          <p className="text-sm font-medium">Nothing saved yet</p>
          <p className="text-sm text-[var(--color-ink-muted)]">
            Install the extension, open a product page, and click <strong>Capture this page</strong>{' '}
            in the side panel. What you save appears here.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-[var(--color-line)] px-4 py-6">
          <p className="text-sm font-medium">Nothing matches those filters</p>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {showingArchived
              ? 'No archived items yet.'
              : 'Try a different search, or clear the filters.'}
          </p>
        </div>
      ) : (
        <ul
          className={
            view === 'cards' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : 'flex flex-col gap-3'
          }
        >
          {visible.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              summary={summaries.get(item.id)}
              view={view}
              busy={busyIds.has(item.id)}
              onOpen={setOpenItem}
              onStatusChange={(target, status) => void changeStatus(target, status)}
              onArchive={(target) => void archive(target)}
            />
          ))}
        </ul>
      )}

      {openItem ? (
        <ItemDetail
          item={items.find((entry) => entry.id === openItem.id) ?? openItem}
          onClose={() => setOpenItem(null)}
          onSave={save}
          onDelete={remove}
        />
      ) : null}

      {undo ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5 text-sm shadow-lg dark:bg-[#0d1015]"
        >
          <span>{undo.message}</span>
          <button
            type="button"
            className="font-medium text-[var(--color-accent)] underline"
            onClick={() => void undo.run()}
          >
            Undo
          </button>
        </div>
      ) : null}
    </section>
  );
}
