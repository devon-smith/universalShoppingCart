'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';

import { MAX_COMPARE_ITEMS } from '@/features/compare/compare';
import { CompareTray } from '@/features/compare/CompareTray';
import { compareHref, toggleSelection } from '@/features/compare/selection';
import { AppShell, type ShellCart } from '@/features/shell/AppShell';

import { archiveItem, deleteItem, setItemStatus, updateItem } from './actions';
import type { Announcement } from './Announcements';
import { Announcements } from './Announcements';
import { CartHeader } from './CartHeader';
import { boardCompareIds, groupByDecision, hasDecisions } from './decisions';
import type { ItemEdit } from './edits';
import { emptyReason, ItemsEmptyState } from './EmptyStates';
import { ItemCard } from './ItemCard';
import { ItemDetail } from './ItemDetail';
import { ItemRow } from './ItemRow';
import { useItemsLayout } from './layout-preference';
import type { ItemFilters, ItemStatus, PriceSummary, SavedItem, SortKey } from './query';
import { activeFilterCount, applyQuery, EMPTY_FILTERS, retailerOptions } from './query';
import { applyRealtimeUpsert, removeItem, replaceItem, withEdit } from './reduce';
import type { SectionId } from './sections';
import { inSection, movedItemIds, SECTIONS, sectionCounts, sectionStatuses } from './sections';
import { useItemsRealtime } from './useItemsRealtime';

/**
 * The dashboard.
 *
 * State owner for the whole signed-in surface: which cart, which section, the query, and the
 * optimistic item list. Everything below is presentational, which is what keeps the shell
 * reusable and each piece testable on its own.
 *
 * Every mutation is applied locally first and rolled back if the server rejects it, so the
 * list never freezes while a write is in flight. Archive offers an undo, because losing a
 * saved product to a mis-click is the failure that would make someone stop trusting the app;
 * deletion has no undo and so is confirmed before it happens instead.
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
  const [layout, changeLayout] = useItemsLayout();
  const [section, setSection] = useState<SectionId>('cart');
  const [cartId, setCartId] = useState(
    carts.find((cart) => cart.is_default)?.id ?? carts[0]?.id ?? '',
  );
  const [openItem, setOpenItem] = useState<SavedItem | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * The comparison selection.
   *
   * Ids rather than items, so an item edited or refreshed while selected stays selected and
   * the tray reads its current title. Held here rather than in the URL because the dashboard
   * is where you *assemble* a comparison; the URL owns it once you open one, which is what
   * makes that page shareable (see `compare/selection.ts`).
   */
  const [comparing, setComparing] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The control that opened the drawer, so closing can hand focus back to it rather than to
  // the top of the document.
  const drawerOpener = useRef<HTMLElement | null>(null);

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

  /**
   * Say one thing, and stop saying the last thing.
   *
   * A failure stays until something replaces it: it needs attention, and a message that
   * vanishes on a timer is one the user may never have seen. Confirmations expire.
   */
  function announce(next: Announcement, holdMs: number | null) {
    if (announcementTimer.current) clearTimeout(announcementTimer.current);
    setAnnouncement(next);
    if (holdMs !== null) {
      announcementTimer.current = setTimeout(() => setAnnouncement(null), holdMs);
    }
  }

  function clearAnnouncement() {
    if (announcementTimer.current) clearTimeout(announcementTimer.current);
    setAnnouncement(null);
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
    clearAnnouncement();
    setItems((current) => replaceItem(current, item.id, apply));

    let succeeded = false;
    await withBusy(item.id, async () => {
      const result = await call();
      if (result.ok) {
        succeeded = true;
        return;
      }

      // Rolled back locally, and said out loud — a silent revert looks like the click missed.
      setItems((current) => replaceItem(current, previous.id, () => previous));
      announce(
        { tone: 'failure', message: result.error ?? 'That change could not be saved.' },
        null,
      );
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
      announce(
        {
          tone: 'success',
          message: `Archived “${item.title}”.`,
          action: {
            label: 'Undo',
            run: () => {
              void optimistic(
                { ...item, status: 'archived' },
                (current) => ({ ...current, status: restored }),
                () => setItemStatus(item.id, restored),
              ).then(() => clearAnnouncement());
            },
          },
        },
        10_000,
      );
    }
  }

  async function save(item: SavedItem, edit: ItemEdit) {
    const ok = await optimistic(
      item,
      (current) => withEdit(current, edit),
      () => updateItem(item.id, edit),
    );

    if (ok) {
      closeDrawer();
      announce({ tone: 'success', message: `Saved your changes to “${item.title}”.` }, 6_000);
    }
  }

  async function remove(item: SavedItem) {
    const previous = items;
    setItems((current) => removeItem(current, item.id));
    closeDrawer();

    const result = await deleteItem(item.id);
    if (!result.ok) {
      setItems(previous);
      announce(
        { tone: 'failure', message: result.error ?? 'That item could not be deleted.' },
        null,
      );
      return;
    }

    // Deletion is permanent and has no undo, so hiding the card is not the same as the work
    // being done. Confirm only once the server has agreed, otherwise navigating away during
    // the request leaves the user believing an item is gone that will reappear on reload.
    announce({ tone: 'success', message: `Deleted “${item.title}”.`, testId: 'notice' }, 6_000);
  }

  /**
   * Opening remembers what was focused; closing gives it back. Without this, dismissing the
   * drawer drops focus to the top of the document and a keyboard user has to tab all the way
   * back to the row they were reading.
   */
  function openDrawer(item: SavedItem) {
    drawerOpener.current = document.activeElement as HTMLElement | null;
    setOpenItem(item);
  }

  function closeDrawer() {
    setOpenItem(null);
    const opener = drawerOpener.current;
    drawerOpener.current = null;
    requestAnimationFrame(() => opener?.focus());
  }

  const activeSection = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0]!;

  // Only items that still exist, in selection order — an archived or deleted item leaving the
  // list must leave the comparison with it, or the tray offers a link to a dead column.
  const comparingItems = comparing
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is SavedItem => item !== undefined)
    .map((item) => ({ id: item.id, title: item.title }));

  const cardProps = {
    onOpen: openDrawer,
    onStatusChange: (target: SavedItem, status: ItemStatus) => void changeStatus(target, status),
    onArchive: (target: SavedItem) => void archive(target),
    onToggleCompare: (target: SavedItem) =>
      setComparing((current) => toggleSelection(current, target.id)),
    comparisonFull: comparingItems.length >= MAX_COMPARE_ITEMS,
  };

  const boards = useMemo(() => groupByDecision(visible), [visible]);

  /** One list of products, in whichever of the two layouts is active. */
  function renderItemList(list: readonly SavedItem[]) {
    return (
      <ul
        className={
          layout === 'cards'
            ? // Denser than the old grid: photographs carry more per pixel than prose, so
              // two columns fit a large phone and four fit a wide desktop without any
              // card starving. 480px is where two 4:5 frames stop being postage stamps.
              'grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
            : 'flex flex-col gap-2'
        }
      >
        {list.map((item) =>
          layout === 'cards' ? (
            <ItemCard
              key={item.id}
              item={item}
              summary={summaries.get(item.id)}
              busy={busyIds.has(item.id)}
              comparing={comparing.includes(item.id)}
              {...cardProps}
            />
          ) : (
            <ItemRow
              key={item.id}
              item={item}
              summary={summaries.get(item.id)}
              busy={busyIds.has(item.id)}
              comparing={comparing.includes(item.id)}
              {...cardProps}
            />
          ),
        )}
      </ul>
    );
  }

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
      {/* The tray is fixed to the bottom, so the list needs room to scroll clear of it —
          otherwise the last product sits permanently underneath the thing you are using to
          choose products. Only while it is there. */}
      <section
        aria-labelledby="items-heading"
        className={['flex flex-col gap-4', comparingItems.length > 0 ? 'pb-44 sm:pb-36' : ''].join(
          ' ',
        )}
      >
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
          onLayoutChange={changeLayout}
        />

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
        ) : hasDecisions(boards) ? (
          // Boards: one per open purchase decision, unassigned candidates last. Rendered only
          // when at least one item names a decision, so a user who never touches the field
          // keeps today's flat view with zero added chrome.
          boards.map((board) => {
            const compareIds = boardCompareIds(board);
            const compare = compareIds ? compareHref(compareIds) : null;

            return (
              <section
                key={board.name ?? ''}
                data-testid="decision-board"
                data-decision={board.name ?? ''}
                className="flex flex-col gap-2"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-base font-semibold tracking-tight">
                    {board.name ?? 'Not yet part of a decision'}
                  </h2>
                  <span className="text-xs text-[var(--uc-foreground-muted)]">
                    {board.items.length === 1
                      ? '1 candidate'
                      : `${board.items.length} candidates`}
                  </span>
                  {compare ? (
                    <Link
                      href={compare}
                      className="uc-focusable rounded-[var(--uc-radius-control)] text-sm text-[var(--uc-primary)]"
                    >
                      Compare these {compareIds!.length} side by side
                    </Link>
                  ) : null}
                </div>
                {renderItemList(board.items)}
              </section>
            );
          })
        ) : (
          renderItemList(visible)
        )}
      </section>

      {openItem ? (
        <ItemDetail
          item={items.find((entry) => entry.id === openItem.id) ?? openItem}
          onClose={closeDrawer}
          onSave={save}
          onDelete={remove}
        />
      ) : null}

      <CompareTray
        items={comparingItems}
        onRemove={(id) => setComparing((current) => current.filter((entry) => entry !== id))}
        onClear={() => setComparing([])}
      />

      {/* Explains the disabled Compare buttons once four are chosen. Rendered once, outside
          the list, because every blocked button points at the same sentence. */}
      <p id="compare-full-hint" className="uc-sr-only">
        Four products is the most that can be compared. Remove one to choose another.
      </p>

      <Announcements announcement={announcement} />
    </AppShell>
  );
}
