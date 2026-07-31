import { Button, Callout } from '@universal-cart/ui';
import { useState } from 'react';

import { publicEnv } from '@/lib/env';
import { getSupabase } from '@/lib/supabase/client';

import type { PriceSummary, SavedItem } from './ItemSummary';
import { ItemSummary } from './ItemSummary';
import type { Cart } from './PanelHeader';

/**
 * The page in front of the user is already in a cart.
 *
 * Not a green box saying so. The useful thing is the product as it stands — what it costs now,
 * whether that differs from the last time an observation recorded a different price, when it
 * was last checked, and which cart it is in — followed by the four things worth doing next.
 *
 * `changed` is whether *this* visit recorded a new observation, which is a different fact from
 * whether the price has moved since it was saved. Both are stated, neither is conflated.
 */
export function KnownItemState({
  item,
  summary,
  changed,
  carts,
  onRefresh,
  onCaptureAnother,
  onMoved,
}: {
  item: SavedItem;
  summary: PriceSummary | null;
  changed: boolean;
  carts: Cart[];
  onRefresh: () => Promise<void>;
  onCaptureAnother: () => void;
  onMoved: () => void;
}) {
  const [busy, setBusy] = useState<null | 'refresh' | 'move' | 'archive'>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [archived, setArchived] = useState(false);

  const cartName = carts.find((cart) => cart.id === item.cart_id)?.name;
  const elsewhere = carts.filter((cart) => cart.id !== item.cart_id);

  async function run(kind: 'move', cartId: string): Promise<void>;
  async function run(kind: 'archive'): Promise<void>;
  async function run(kind: 'move' | 'archive', cartId?: string) {
    setBusy(kind);
    setError(null);

    // Typed per column rather than as a loose record: `items` has thirty of them and a
    // stringly-typed patch would let a typo through to the database.
    const client = getSupabase();
    const { error: failure } =
      kind === 'archive'
        ? await client.from('items').update({ status: 'archived' }).eq('id', item.id)
        : await client.from('items').update({ cart_id: cartId! }).eq('id', item.id);
    setBusy(null);

    if (failure) {
      setError(failure.message);
      return;
    }

    if (kind === 'archive') setArchived(true);
    setMoving(false);
    onMoved();
  }

  if (archived) {
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
      <p className="uc-sr-only" role="status" aria-live="polite">
        {`${item.title} is already in ${cartName ?? 'your cart'}.`}
        {changed ? ' This visit recorded a new price or availability.' : ''}
      </p>

      <p className="saved-state__headline">Already in your cart</p>

      <ItemSummary item={item} summary={summary} cartName={cartName} />

      {/* Said only when an observation was actually written on this visit. Silence otherwise —
          "nothing has changed" would claim a comparison that may not have been made. */}
      {changed ? (
        <Callout tone="success" announce={false}>
          This visit recorded a new price or availability.
        </Callout>
      ) : null}

      {error ? <Callout tone="danger">{error}</Callout> : null}

      <div className="saved-state__actions">
        <Button
          onClick={() => {
            setBusy('refresh');
            void onRefresh().finally(() => setBusy(null));
          }}
          disabled={busy !== null}
        >
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh details'}
        </Button>
        <a
          className="uc-button uc-button--secondary uc-focusable saved-state__view"
          href={`${publicEnv.WXT_PUBLIC_APP_URL}/app`}
          target="_blank"
          rel="noreferrer"
        >
          Open item
        </a>
      </div>

      <div className="saved-state__actions">
        {elsewhere.length > 0 ? (
          <Button onClick={() => setMoving((open) => !open)} disabled={busy !== null}>
            Move to another cart
          </Button>
        ) : null}
        <Button tone="ghost" onClick={() => void run('archive')} disabled={busy !== null}>
          {busy === 'archive' ? 'Archiving…' : 'Archive'}
        </Button>
      </div>

      {moving ? (
        <div className="saved-state__move">
          <label className="uc-sr-only" htmlFor="move-target">
            Move to cart
          </label>
          <select
            id="move-target"
            className="uc-input uc-focusable"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) void run('move', event.target.value);
            }}
          >
            <option value="" disabled>
              Choose a cart…
            </option>
            {elsewhere.map((cart) => (
              <option key={cart.id} value={cart.id}>
                {cart.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

export type { PriceSummary, SavedItem };
