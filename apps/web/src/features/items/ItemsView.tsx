'use client';

import { Toast } from '@universal-cart/ui';
import { useCallback, useMemo, useRef, useState } from 'react';

import { AppShell, type ShellCart } from '@/features/shell/AppShell';

import { archiveItem, deleteItem, setItemStatus, updateItem } from './actions';
import { CartHeader, type ItemsLayout } from './CartHeader';
import type { ItemEdit } from './edits';
import { emptyReason, ItemsEmptyState } from './EmptyStates';
import { ItemCard } from './ItemCard';
import { ItemDetail } from './ItemDetail';
import { ItemRow } from './ItemRow';
import type { ItemFilters, ItemStatus, PriceSummary, SavedItem, SortKey } from './query';
import { activeFilterCount, applyQuery, EMPTY_FILTERS, retailerOptions } from './query';
import { applyRealtimeUpsert, removeItem, replaceItem, withEdit } from './reduce';
import type { SectionId } from './sections';
import { inSection, movedItemIds, SECTIONS, sectionCounts, sectionStatuses } from './sections';
import { useItemsRealtime } from './useItemsRealtime';

interface Undo {
  message: string;
  run: () => Promise<void>;
}

/**
 * The dashboard.
 *
 * State owner for the whole signed-in surface: which cart, which section, the query, and the
 * optimistic item list. Everything below is presentational, which is what keeps the shell
 * reusable and each piece testable on its own.
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
  carts,
  email,
  signOut,
}: {
  initialItems: SavedItem[];
  priceSummaries: PriceSummary[];
  cartIds: string[];
  carts: ShellCart[];
  email: string;
  signOut: () => void;
}) {
  const [items, setItems] = useState(initialItems);
  const [filters, setFilters] = useState<ItemFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('recently-updated');
  const [layout, setLayout] = useState<ItemsLayout>('list');
  const [section, setSection] = useState<SectionId>('cart');
  const [cartId, setCartId] = useState(
    carts.find((cart) => cart.is_default)?.id ?? carts[0]?.id ?? '',
  );
  const [openItem, setOpenItem] = useState<SavedItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const summaries = useMemo(
    () => new Map(priceSummaries.map((summary) => [summary.item_id, summary])),
    [priceSummaries],
  );

  // The selected cart, then the section, then the user's own query. Each stage narrows the one
  // before it, so the counts beside the nav describe the cart actually on screen.
  const inCart = useMemo(
    () => (cartId ? items.filter((item) => item.cart_id === cartId) : items),
    [items, cartId],
  );
  const moved = useMemo(() => movedItemIds(inCart, summaries), [inCart, summaries]);
  const counts = useMemo(() => sectionCounts(inCart, moved), [inCart, moved]);

  const sectionItems = useMemo(
    () => inCart.filter((item) => inSection(item, section, moved)),
    [inCart, section, moved],
  );
  // The section already narrowed by status, but `filterItems` re-applies the status rule and
  // its "no statuses means hide archived" default would then throw the Archived section's own
  // items away. Handing it the section's statuses keeps the two from disagreeing.
  const visible = useMemo(
    () => applyQuery(sectionItems, { ...filters, statuses: sectionStatuses(section) }, sort),
    [sectionItems, filters, sort, section],
  );
  const retailers = useMemo(() => retailerOptions(inCart), [inCart]);

  const lastUpdated = useMemo(
    () =>
      sectionItems.reduce<string | null>(
        (latest, item) => (latest === null || item.updated_at > latest ? item.updated_at : latest),
        null,
      ),
    [sectionItems],
  );

  function offerUndo(message: string, run: () => Promise<void>) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ message, run });
    undoTimer.current = setTimeout(() => setUndo(null), 10_000);
  }

  /** Confirmation for a write that has no undo. Shown only once the server has agreed. */
  function showNotice(message: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), 6_000);
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
      return;
    }

    // Deletion is permanent and has no undo, so hiding the card is not the same as the work
    // being done. Confirm only once the server has agreed, otherwise navigating away during
    // the request leaves the user believing an item is gone that will reappear on reload.
    showNotice(`Deleted “${item.title}”.`);
  }

  const activeSection = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0]!;
  const cardProps = {
    onOpen: setOpenItem,
    onStatusChange: (target: SavedItem, status: ItemStatus) => void changeStatus(target, status),
    onArchive: (target: SavedItem) => void archive(target),
  };

  return (
    <AppShell
      carts={carts}
      cartId={cartId}
      onCartChange={setCartId}
      section={section}
      onSectionChange={setSection}
      counts={counts}
      email={email}
      signOut={signOut}
      search={filters.search}
      onSearchChange={(search) => setFilters({ ...filters, search })}
    >
      <section aria-labelledby="items-heading" className="flex flex-col gap-4">
        <CartHeader
          section={activeSection}
          cartName={carts.find((cart) => cart.id === cartId)?.name ?? null}
          shown={visible.length}
          total={sectionItems.length}
          lastUpdated={lastUpdated}
          filters={filters}
          onFiltersChange={setFilters}
          retailers={retailers}
          sort={sort}
          onSortChange={setSort}
          layout={layout}
          onLayoutChange={setLayout}
        />

        {error ? (
          <p role="alert" className="uc-callout uc-callout--danger">
            {error}
          </p>
        ) : null}

        {visible.length === 0 ? (
          <ItemsEmptyState
            reason={emptyReason({
              totalItems: inCart.length,
              sectionCount: sectionItems.length,
              section,
              search: filters.search,
              activeFilters: activeFilterCount(filters),
            })}
            onClearSearch={() => setFilters({ ...filters, search: '' })}
            onClearFilters={() => setFilters({ ...EMPTY_FILTERS, search: filters.search })}
          />
        ) : (
          <ul
            className={
              layout === 'cards'
                ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'
                : 'flex flex-col gap-2'
            }
          >
            {visible.map((item) =>
              layout === 'cards' ? (
                <ItemCard
                  key={item.id}
                  item={item}
                  summary={summaries.get(item.id)}
                  busy={busyIds.has(item.id)}
                  {...cardProps}
                />
              ) : (
                <ItemRow
                  key={item.id}
                  item={item}
                  summary={summaries.get(item.id)}
                  busy={busyIds.has(item.id)}
                  {...cardProps}
                />
              ),
            )}
          </ul>
        )}
      </section>

      {openItem ? (
        <ItemDetail
          item={items.find((entry) => entry.id === openItem.id) ?? openItem}
          onClose={() => setOpenItem(null)}
          onSave={save}
          onDelete={remove}
        />
      ) : null}

      {undo ? (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <Toast
            message={undo.message}
            action={
              <button
                type="button"
                className="uc-focusable font-medium text-[var(--uc-primary)] underline"
                onClick={() => void undo.run()}
              >
                Undo
              </button>
            }
          />
        </div>
      ) : notice ? (
        <div data-testid="notice" className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <Toast message={notice} />
        </div>
      ) : null}
    </AppShell>
  );
}
