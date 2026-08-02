'use server';

import type { TablesUpdate } from '@universal-cart/contracts';

import { createServerSupabase } from '@/lib/supabase/server';

import type { ItemEdit } from './edits';
import { itemEditSchema, itemStatusSchema, toColumns } from './edits';

/**
 * Mutations for the user-authored fields of a saved item.
 *
 * These write through the ordinary `items` table, not through a function: Row Level
 * Security decides who may write, and the `items_protect_observed_fields` trigger decides
 * *what* may be written. A client cannot touch the retailer-observed columns even by
 * sending them, so these actions do not need to filter defensively.
 *
 * None of them call `revalidatePath`. The caller already applied the change optimistically
 * and Realtime delivers anything it missed; forcing a server re-render on every keystroke-
 * scale mutation would refetch the whole list and race the optimistic state it is meant to
 * confirm.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function requireUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not signed in');
  }

  return supabase;
}

export async function updateItem(itemId: string, edit: ItemEdit): Promise<ActionResult> {
  const parsed = itemEditSchema.safeParse(edit);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That edit is not valid.' };
  }

  const supabase = await requireUser();

  // `desired_price` is sent as a decimal string. The generated type says `number`, because
  // that is how PostgREST *reports* a numeric; it accepts a string on the way in and stores
  // it exactly, which is the whole point of not putting money in a double.
  const columns = toColumns(parsed.data) as unknown as TablesUpdate<'items'>;
  const { error } = await supabase.from('items').update(columns).eq('id', itemId);

  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/** Quick status change from a card, without opening the detail view. */
export async function setItemStatus(itemId: string, status: string): Promise<ActionResult> {
  const parsed = itemStatusSchema.safeParse(status);
  if (!parsed.success) {
    return { ok: false, error: 'Unknown status.' };
  }

  const supabase = await requireUser();
  const { error } = await supabase.from('items').update({ status: parsed.data }).eq('id', itemId);

  if (error) return { ok: false, error: error.message };

  return { ok: true };
}

/**
 * Archive rather than delete.
 *
 * Archiving keeps the item and its observation history, which is what makes undo instant
 * and what keeps a price record from disappearing because someone tidied their list.
 */
export async function archiveItem(itemId: string): Promise<ActionResult> {
  return setItemStatus(itemId, 'archived');
}

export async function restoreItem(itemId: string, status = 'saved'): Promise<ActionResult> {
  return setItemStatus(itemId, status);
}

/**
 * Permanent deletion. Offered only from the item detail view, after archiving.
 *
 * Cascades to `item_observations`; there is no undo, which is why the UI asks first.
 */
export async function deleteItem(itemId: string): Promise<ActionResult> {
  const supabase = await requireUser();
  const { error } = await supabase.from('items').delete().eq('id', itemId);

  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
