import { Button, EmptyState, Price, ProductImage, StatusBadge } from '@universal-cart/ui';
import { useEffect, useState } from 'react';

import { publicEnv } from '@/lib/env';
import { relativeTime } from '@/lib/format/time';
import { getSupabase } from '@/lib/supabase/client';

type ItemStatus = 'saved' | 'cart' | 'purchased' | 'archived';

interface RecentItem {
  id: string;
  title: string;
  retailer_name: string;
  currency: string | null;
  current_price: string | number | null;
  image_url: string | null;
  availability: string | null;
  last_observed_at: string | null;
  source_url: string;
  status: ItemStatus;
}

type State =
  | { name: 'loading' }
  | { name: 'ready'; items: RecentItem[]; previous: Record<string, string | null> }
  | { name: 'error'; message: string };

const STATUS_LABELS: Record<ItemStatus, string> = {
  saved: 'Saved',
  cart: 'In cart',
  purchased: 'Purchased',
  archived: 'Archived',
};

/** How many rows the panel shows before deferring to the dashboard. */
const INITIAL_ROWS = 3;
const MAX_ROWS = 8;

export function RecentItems({ reloadKey }: { reloadKey: number }) {
  const [state, setState] = useState<State>({ name: 'loading' });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      const client = getSupabase();

      // Money as text: PostgREST would otherwise hand back a JSON number, which is a double.
      const { data, error } = await client
        .from('items')
        .select(
          'id, title, retailer_name, currency, current_price::text, image_url, availability, last_observed_at, source_url, status',
        )
        .neq('status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(MAX_ROWS);

      if (!active) return;

      if (error) {
        setState({ name: 'error', message: error.message });
        return;
      }

      const items = (data ?? []) as unknown as RecentItem[];

      // One extra query for the whole page of rows rather than one per row. An item with a
      // single observation simply has no entry, and no movement is claimed for it.
      const previous: Record<string, string | null> = {};
      if (items.length > 0) {
        const { data: summaries } = await client
          .from('item_price_summary')
          .select('item_id, previous_price::text')
          .in(
            'item_id',
            items.map((item) => item.id),
          );

        for (const row of (summaries ?? []) as unknown as {
          item_id: string;
          previous_price: string | null;
        }[]) {
          previous[row.item_id] = row.previous_price;
        }
      }

      if (active) setState({ name: 'ready', items, previous });
    }

    void load();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const dashboard = `${publicEnv.WXT_PUBLIC_APP_URL}/app`;

  return (
    <section className="recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="recent__heading">
        Recently saved
      </h2>

      {state.name === 'loading' ? <p className="recent__note">Loading…</p> : null}

      {state.name === 'error' ? (
        <p role="alert" className="recent__note recent__note--error">
          {state.message}
        </p>
      ) : null}

      {state.name === 'ready' && state.items.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Open a product page and press Capture. Saved products appear here and on the dashboard."
        />
      ) : null}

      {state.name === 'ready' && state.items.length > 0 ? (
        <>
          <ul className="recent__list">
            {(expanded ? state.items : state.items.slice(0, INITIAL_ROWS)).map((item) => (
              <RecentRow key={item.id} item={item} previous={state.previous[item.id] ?? null} />
            ))}
          </ul>

          {!expanded && state.items.length > INITIAL_ROWS ? (
            <Button tone="ghost" fullWidth onClick={() => setExpanded(true)}>
              Show {state.items.length - INITIAL_ROWS} more
            </Button>
          ) : null}

          <a className="recent__all uc-focusable" href={dashboard} target="_blank" rel="noreferrer">
            View all in the dashboard
          </a>
        </>
      ) : null}
    </section>
  );
}

/**
 * One row: enough to recognise the product, and nothing more.
 *
 * The row links to the dashboard rather than to the retailer. From the panel the useful next
 * step is the place the item can be compared and edited; the retailer page is usually the one
 * the user is already looking at.
 */
function RecentRow({ item, previous }: { item: RecentItem; previous: string | null }) {
  const [imageUsable, setImageUsable] = useState(true);
  const image = imageUsable ? item.image_url : null;

  const current = item.current_price === null ? null : String(item.current_price);
  const fell = current !== null && previous !== null && Number(current) < Number(previous);
  const rose = current !== null && previous !== null && Number(current) > Number(previous);

  return (
    <li className="recent__item">
      <a
        className="recent__link uc-focusable"
        href={`${publicEnv.WXT_PUBLIC_APP_URL}/app`}
        target="_blank"
        rel="noreferrer"
      >
        <ProductImage
          src={image}
          alt=""
          className="recent__thumb"
          onUnavailable={() => setImageUsable(false)}
        />

        <span className="recent__body">
          <span className="recent__title">{item.title}</span>
          <span className="recent__retailer">{item.retailer_name}</span>

          <span className="recent__figures">
            <Price
              cadence="one_time"
              value={current === null ? null : { amount: current, currency: item.currency }}
              unknownLabel="No price"
            />
            {/* Only ever from two real observations. An item seen once shows no signal at all,
                rather than a reassuring flat one it has not earned. */}
            {fell ? <StatusBadge tone="success">▼ fell</StatusBadge> : null}
            {rose ? <StatusBadge tone="neutral">▲ rose</StatusBadge> : null}
            {item.availability === 'out_of_stock' ? (
              <StatusBadge tone="warning">Out of stock</StatusBadge>
            ) : null}
          </span>

          <span className="recent__meta">
            {STATUS_LABELS[item.status]} · checked {relativeTime(item.last_observed_at)}
          </span>
        </span>
      </a>
    </li>
  );
}
