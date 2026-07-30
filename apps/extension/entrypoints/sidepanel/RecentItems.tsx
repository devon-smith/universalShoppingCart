import { Price, StatusBadge } from '@universal-cart/ui';
import { useEffect, useState } from 'react';

import { getSupabase } from '@/lib/supabase/client';

type ItemStatus = 'saved' | 'cart' | 'purchased' | 'archived';

interface RecentItem {
  id: string;
  title: string;
  retailer_name: string;
  currency: string | null;
  current_price: string | number | null;
  source_url: string;
  status: ItemStatus;
}

type State =
  { name: 'loading' } | { name: 'ready'; items: RecentItem[] } | { name: 'error'; message: string };

const STATUS_LABELS: Record<ItemStatus, string> = {
  saved: 'Saved',
  cart: 'In cart',
  purchased: 'Purchased',
  archived: 'Archived',
};

/** The one useful next step from the panel, given where the item is. */
const NEXT_STATUS: Partial<Record<ItemStatus, { to: ItemStatus; label: string }>> = {
  saved: { to: 'cart', label: 'Move to cart' },
  cart: { to: 'purchased', label: 'Purchased' },
};

export function RecentItems({ reloadKey }: { reloadKey: number }) {
  const [state, setState] = useState<State>({ name: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Money as text: PostgREST would otherwise hand back a JSON number, which is a double.
    getSupabase()
      .from('items')
      .select('id, title, retailer_name, currency, current_price::text, source_url, status')
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(5)
      .then(({ data, error }) => {
        if (!active) return;
        setState(
          error
            ? { name: 'error', message: error.message }
            : { name: 'ready', items: (data ?? []) as unknown as RecentItem[] },
        );
      });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function changeStatus(item: RecentItem, status: ItemStatus) {
    if (state.name !== 'ready') return;

    const previous = state.items;
    setBusyId(item.id);
    // Optimistic: the row moves immediately, and comes back if the write is refused.
    setState({
      name: 'ready',
      items: previous.map((entry) => (entry.id === item.id ? { ...entry, status } : entry)),
    });

    const { error } = await getSupabase().from('items').update({ status }).eq('id', item.id);
    setBusyId(null);

    if (error) {
      setState({ name: 'ready', items: previous });
    }
  }

  return (
    <section className="panel__section" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="panel__section-title">
        Recently saved
      </h2>

      {state.name === 'loading' ? <p className="panel__subtitle">Loading…</p> : null}

      {state.name === 'error' ? (
        <p role="alert" className="panel__error">
          {state.message}
        </p>
      ) : null}

      {state.name === 'ready' && state.items.length === 0 ? (
        <p className="panel__subtitle">Nothing saved yet. Capture a product page to start.</p>
      ) : null}

      {state.name === 'ready' && state.items.length > 0 ? (
        <ul className="panel__list">
          {state.items.map((item) => {
            const next = NEXT_STATUS[item.status];

            return (
              <li key={item.id} className="panel__list-item">
                <a href={item.source_url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
                <span className="panel__meta">
                  <Price
                    cadence="one_time"
                    value={
                      item.current_price === null
                        ? null
                        : { amount: String(item.current_price), currency: item.currency }
                    }
                    unknownLabel="No price"
                  />
                  <StatusBadge tone="neutral">{STATUS_LABELS[item.status]}</StatusBadge>
                </span>
                {next ? (
                  <button
                    type="button"
                    className="panel__link-button"
                    disabled={busyId === item.id}
                    onClick={() => void changeStatus(item, next.to)}
                  >
                    {next.label}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
