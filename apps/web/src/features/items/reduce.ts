import type { ItemEdit } from './edits';
import type { SavedItem } from './query';

/**
 * Local cache updates.
 *
 * Kept as pure reducers so the optimistic path, the realtime path, and the rollback path
 * are all the same code — and so all three can be tested without a browser.
 */

/** Apply an edit to an item, as the database will once the write lands. */
export function withEdit(item: SavedItem, edit: ItemEdit): SavedItem {
  return {
    ...item,
    note: edit.note,
    quantity: edit.quantity,
    priority: edit.priority,
    desired_price: edit.desiredPrice,
    status: edit.status,
    // The server stamps this too; matching it locally keeps "recently updated" honest
    // between the optimistic render and the realtime confirmation.
    updated_at: new Date().toISOString(),
  };
}

export function upsertItem(items: readonly SavedItem[], next: SavedItem): SavedItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [...items, next];

  const copy = [...items];
  copy[index] = next;
  return copy;
}

export function removeItem(items: readonly SavedItem[], id: string): SavedItem[] {
  return items.filter((item) => item.id !== id);
}

export function replaceItem(
  items: readonly SavedItem[],
  id: string,
  update: (item: SavedItem) => SavedItem,
): SavedItem[] {
  return items.map((item) => (item.id === id ? update(item) : item));
}

/**
 * Merge a realtime row into the cache.
 *
 * Realtime delivers rows for carts the page may not be showing; those are ignored rather
 * than added, so a shared cart opened in another tab does not leak into this view.
 */
export function applyRealtimeUpsert(
  items: readonly SavedItem[],
  next: SavedItem,
  visibleCartIds: readonly string[],
): SavedItem[] {
  if (!visibleCartIds.includes(next.cart_id)) return [...items];
  return upsertItem(items, next);
}
