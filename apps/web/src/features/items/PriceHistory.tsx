'use client';

import { formatMoney } from './format';
import { availabilityLabel } from './format';

export interface Observation {
  id: number;
  observed_at: string;
  price: string | number | null;
  currency: string | null;
  availability: string;
  source: string;
}

const SOURCE_LABELS: Record<string, string> = {
  capture: 'saved',
  revisit: 'revisited',
  manual: 'edited',
  background: 'background check',
};

/**
 * Observation history for one item.
 *
 * A list rather than a chart. With the handful of observations a personal cart accumulates
 * before background refresh exists, a sparkline would be decoration over three points; the
 * dates and sources are the information — "the price dropped when I revisited" is the
 * question this answers.
 */
export function PriceHistory({
  observations,
  loading,
}: {
  observations: Observation[] | null;
  loading: boolean;
}) {
  if (loading) {
    return <p className="text-xs text-[var(--color-ink-muted)]">Loading history…</p>;
  }

  if (!observations || observations.length === 0) {
    return (
      <p className="text-xs text-[var(--color-ink-muted)]">
        No observations recorded yet. Revisiting the product page adds one when something changes.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-1.5" aria-label="Price history">
      {observations.map((observation) => {
        const price = formatMoney(observation.price, observation.currency);

        return (
          <li key={observation.id} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="font-medium">{price ?? 'Price unknown'}</span>
            <span className="text-[var(--color-ink-muted)]">
              {availabilityLabel(observation.availability)} ·{' '}
              {new Date(observation.observed_at).toLocaleString()} ·{' '}
              {SOURCE_LABELS[observation.source] ?? observation.source}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
