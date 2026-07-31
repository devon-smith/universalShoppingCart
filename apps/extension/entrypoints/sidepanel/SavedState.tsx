import { Button, Callout } from '@universal-cart/ui';
import { useEffect, useRef, useState } from 'react';

import { publicEnv } from '@/lib/env';
import { getSupabase } from '@/lib/supabase/client';

import type { PriceSummary, SavedItem } from './ItemSummary';
import { ItemSummary } from './ItemSummary';

/**
 * What the panel shows once a save has landed.
 *
 * Two different things can have happened and they get two different sentences. A **new** item
 * was added to a cart. A **refresh** means the product was already there and its observed
 * fields were re-recorded — nothing was added, and saying "Saved" would be a small lie that
 * makes the cart count look wrong.
 *
 * The product stays on screen throughout. A success state that replaces the thing you just
 * acted on with a green box gives you nothing to check the action against.
 */
export function SavedState({
  item,
  created,
  summary,
  cartName,
  onCaptureAnother,
  onUndone,
}: {
  item: SavedItem;
  created: boolean;
  summary: PriceSummary | null;
  cartName?: string;
  onCaptureAnother: () => void;
  onUndone: () => void;
}) {
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const actions = useRef<HTMLDivElement>(null);

  // Focus lands on the actions rather than nowhere. After a save the panel's content changes
  // under a keyboard user whose focus was on a button that no longer exists, and focus falling
  // back to <body> means tabbing restarts from the top of the panel.
  useEffect(() => {
    actions.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, []);

  /**
   * Undo a newly created item by archiving it.
   *
   * Only offered when something was created. Undoing a *refresh* would mean deleting an
   * observation the user asked for, which is not what "undo" means to them and would remove a
   * true record of what the page said.
   *
   * Archive rather than delete, matching the dashboard: the row keeps its history and can come
   * back, and nothing the user wrote is destroyed by a mis-click.
   */
  async function undo() {
    setUndoing(true);
    setUndoError(null);

    const { error } = await getSupabase()
      .from('items')
      .update({ status: 'archived' })
      .eq('id', item.id);

    setUndoing(false);

    if (error) {
      setUndoError(error.message);
      return;
    }

    setUndone(true);
    onUndone();
  }

  if (undone) {
    return (
      <div className="saved-state">
        <Callout tone="neutral" title="Archived">
          “{item.title}” is out of your cart. You can restore it from the dashboard.
        </Callout>
        <Button tone="primary" fullWidth onClick={onCaptureAnother}>
          Capture this page
        </Button>
      </div>
    );
  }

  return (
    <div className="saved-state">
      {/* One announcement, phrased as the outcome rather than as a status word. */}
      <p className="uc-sr-only" role="status" aria-live="polite">
        {created
          ? `Saved ${item.title}${cartName ? ` to ${cartName}` : ''}.`
          : `Already saved — “${item.title}” details refreshed.`}
      </p>

      <p className="saved-state__headline">
        {created ? (
          <>
            <span className="saved-state__tick" aria-hidden="true">
              ✓
            </span>{' '}
            Saved
            {cartName ? (
              <>
                {' '}
                to <strong>{cartName}</strong>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className="saved-state__tick" aria-hidden="true">
              ✓
            </span>{' '}
            Already saved — details refreshed
          </>
        )}
      </p>

      <ItemSummary item={item} summary={summary} cartName={created ? undefined : cartName} />

      {undoError ? <Callout tone="danger">Could not undo: {undoError}</Callout> : null}

      <div className="saved-state__actions" ref={actions}>
        <a
          className="uc-button uc-button--secondary uc-focusable saved-state__view"
          href={`${publicEnv.WXT_PUBLIC_APP_URL}/app`}
          target="_blank"
          rel="noreferrer"
        >
          View in cart
        </a>
        {created ? (
          <Button onClick={() => void undo()} disabled={undoing}>
            {undoing ? 'Undoing…' : 'Undo'}
          </Button>
        ) : null}
      </div>

      {/* The panel stays useful. Without this the success state is a dead end and the only way
          on is to close and reopen the panel. */}
      <Button tone="ghost" fullWidth onClick={onCaptureAnother}>
        Capture this page again
      </Button>
    </div>
  );
}
