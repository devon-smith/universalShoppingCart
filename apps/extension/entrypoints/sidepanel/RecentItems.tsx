import { useEffect, useState } from 'react';

import { getSupabase } from '@/lib/supabase/client';

interface RecentItem {
  id: string;
  title: string;
  retailer_name: string;
  currency: string | null;
  current_price: string | number | null;
  source_url: string;
}

/** Format money for display without ever doing arithmetic on it. */
function formatPrice(amount: string | number | null, currency: string | null): string | null {
  if (amount === null) return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return String(amount);

  return currency
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
    : value.toFixed(2);
}

export function RecentItems({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<RecentItem[] | null>(null);

  useEffect(() => {
    let active = true;

    getSupabase()
      .from('items')
      .select('id, title, retailer_name, currency, current_price, source_url')
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (active) setItems(data ?? []);
      });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  return (
    <section className="panel__section" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="panel__section-title">
        Recently saved
      </h2>

      {items === null ? <p className="panel__subtitle">Loading…</p> : null}
      {items !== null && items.length === 0 ? (
        <p className="panel__subtitle">Nothing saved yet. Capture a product page to start.</p>
      ) : null}

      {items !== null && items.length > 0 ? (
        <ul className="panel__list">
          {items.map((item) => {
            const price = formatPrice(item.current_price, item.currency);
            return (
              <li key={item.id} className="panel__list-item">
                <a href={item.source_url} target="_blank" rel="noreferrer">
                  {item.title}
                </a>
                <span className="panel__meta">
                  {item.retailer_name}
                  {price ? ` · ${price}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
