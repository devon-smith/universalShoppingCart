'use client';

import { useEffect } from 'react';

import { getBrowserSupabase } from '@/lib/supabase/browser';

import type { SavedItem } from './query';

export type ItemChange = { type: 'upsert'; item: SavedItem } | { type: 'delete'; id: string };

/**
 * Keep the list in sync with the database while the page is open.
 *
 * Subscribes to changes on `items` and patches the local cache (BUILD_PLAN.md §13.1) — no
 * full refetch, because the payload already carries the row. Row Level Security applies to
 * Realtime too, so a subscription cannot deliver a row the user could not have read.
 */
export function useItemsRealtime(
  cartIds: readonly string[],
  onChange: (change: ItemChange) => void,
): void {
  // A stable dependency: the effect should re-run when the set of carts changes, not when
  // the array identity does.
  const key = [...cartIds].sort().join(',');

  useEffect(() => {
    if (key.length === 0) return;

    const carts = new Set(key.split(','));
    const supabase = getBrowserSupabase();

    const channel = supabase
      .channel(`items:${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id?: string }).id;
          if (id) onChange({ type: 'delete', id });
          return;
        }

        const item = payload.new as SavedItem;
        if (item?.id && carts.has(item.cart_id)) {
          onChange({ type: 'upsert', item });
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [key, onChange]);
}
