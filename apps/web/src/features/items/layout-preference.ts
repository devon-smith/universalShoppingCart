import { useCallback, useSyncExternalStore } from 'react';

import type { ItemsLayout } from './CartHeader';

/**
 * Which view of the cart a person last chose, remembered across visits.
 *
 * Cards are the default: this product exists to put garments side by side, and photographs
 * are how anyone tells three jackets apart. The list remains one press away for scanning
 * price and availability down a column, and a person who picks it should not have to pick
 * it again tomorrow.
 *
 * `useSyncExternalStore` rather than state-plus-effect: the server snapshot is the default,
 * the client snapshot reads storage, and React reconciles the two without a hydration
 * mismatch or a setState-in-effect cascade.
 */

const STORAGE_KEY = 'uc:items-layout';
const DEFAULT_LAYOUT: ItemsLayout = 'cards';

/** The stored string, believed only when it names a real layout. */
export function parseStoredLayout(stored: string | null): ItemsLayout {
  return stored === 'list' || stored === 'cards' ? stored : DEFAULT_LAYOUT;
}

/**
 * In-memory copy, authoritative once the user has chosen this visit. Storage is only the
 * persistence behind it — in private browsing `setItem` can refuse, and the toggle must
 * still work for the session it was pressed in.
 */
let chosenLayout: ItemsLayout | null = null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readLayout(): ItemsLayout {
  if (chosenLayout !== null) return chosenLayout;
  try {
    return parseStoredLayout(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useItemsLayout(): [ItemsLayout, (next: ItemsLayout) => void] {
  const layout = useSyncExternalStore(subscribe, readLayout, () => DEFAULT_LAYOUT);

  const setLayout = useCallback((next: ItemsLayout) => {
    chosenLayout = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Refused storage costs persistence, not the choice itself.
    }
    for (const listener of listeners) listener();
  }, []);

  return [layout, setLayout];
}
