'use client';

import { Skeleton } from '@universal-cart/ui';

import { availabilityLabel, formatMoney, relativeTime } from './format';
import type { Observation } from './history';
import { changeDirection, summarizeHistory } from './history';
import { buildSparkline, pricedPoints } from './sparkline';

export type { Observation };

const SOURCE_LABELS: Record<string, string> = {
  capture: 'when you saved it',
  revisit: 'when you revisited',
  manual: 'edited by you',
  background: 'background check',
};

/**
 * What a price has done since it was saved.
 *
 * The list stays — the ADR is that dates and sources are the information, and a chart alone
 * would throw away "the price dropped when I revisited". What changed is the emphasis. The old
 * list gave the price a small font and handed the rest of the row to a full
 * `toLocaleString()` timestamp, so the least interesting value on each line was the widest
 * thing on it.
 *
 * Above the list, the four figures a person actually wants: what it is now, the least and most
 * it has been seen at, and what it cost when it entered the cart. Beside them a sparkline,
 * because the run has a shape the rows cannot show — see `sparkline.ts` for why it is drawn
 * only from three observations up.
 *
 * Every figure is read from a recorded observation. Nothing is projected, and with a single
 * observation the "since you saved it" line is absent rather than zero.
 */
export function PriceHistory({
  observations,
  loading,
  currency,
}: {
  observations: Observation[] | null;
  loading: boolean;
  currency: string | null;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span className="uc-sr-only" role="status">
          Loading price history
        </span>
        <Skeleton height="3.5rem" />
        <Skeleton height="1rem" width="70%" />
      </div>
    );
  }

  if (!observations || observations.length === 0) {
    return (
      <p className="text-sm text-[var(--uc-foreground-muted)]">
        Nothing recorded yet. Universal Cart re-checks a price when you open the product page again
        with the extension — it does not check on its own.
      </p>
    );
  }

  const summary = summarizeHistory(observations);
  const sparkline = buildSparkline(summary, pricedPoints(observations));
  const direction = changeDirection(summary);
  const money = (amount: string | null | undefined) =>
    amount === null || amount === undefined ? '—' : (formatMoney(amount, currency) ?? amount);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1.5 text-sm sm:grid-cols-4">
          <div className="flex flex-col">
            <dt className="text-xs text-[var(--uc-foreground-muted)]">Now</dt>
            <dd className="font-semibold tabular-nums">{money(summary.current?.amount)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-[var(--uc-foreground-muted)]">Lowest seen</dt>
            <dd className="tabular-nums">{money(summary.lowest?.amount)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-[var(--uc-foreground-muted)]">Highest seen</dt>
            <dd className="tabular-nums">{money(summary.highest?.amount)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-[var(--uc-foreground-muted)]">When you saved it</dt>
            <dd className="tabular-nums">{money(summary.atSaved?.amount)}</dd>
          </div>
        </dl>

        {sparkline ? (
          <figure className="m-0 flex flex-col gap-1">
            {/* Decorative: every number it encodes is in the figures above and the list below,
                so a screen reader gains nothing from the path and would have to sit through
                it. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="h-10 w-28 overflow-visible"
            >
              <polyline
                points={sparkline.path}
                fill="none"
                stroke="var(--uc-primary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <figcaption className="text-[0.6875rem] text-[var(--uc-foreground-muted)]">
              {observations.length} observations
            </figcaption>
          </figure>
        ) : null}
      </div>

      {summary.changeSinceSaved !== null && direction !== 'none' ? (
        <p className="text-sm">
          <span aria-hidden="true">{direction === 'down' ? '▼' : '▲'}</span>{' '}
          <span
            className={
              direction === 'down'
                ? 'font-semibold text-[var(--uc-success)]'
                : 'font-semibold text-[var(--uc-foreground)]'
            }
          >
            {money(summary.changeSinceSaved.replace(/^-/, ''))}
            {summary.percentSinceSaved !== null ? ` (${summary.percentSinceSaved}%)` : ''}
          </span>{' '}
          <span className="text-[var(--uc-foreground-muted)]">
            {direction === 'down' ? 'cheaper' : 'dearer'} than when you saved it
          </span>
        </p>
      ) : null}

      {summary.pricedCount === 1 ? (
        <p className="text-sm text-[var(--uc-foreground-muted)]">
          Observed once. Open the product page again with the extension and its price is re-checked
          — nothing is checked in the background.
        </p>
      ) : null}

      <ol className="flex flex-col" aria-label="Price history">
        {observations.map((observation) => (
          <li
            key={observation.id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-[var(--uc-border)] py-1.5 last:border-b-0"
          >
            <span className="font-semibold tabular-nums">
              {formatMoney(observation.price, observation.currency) ?? 'Price unknown'}
            </span>
            <span className="text-xs text-[var(--uc-foreground-muted)]">
              {availabilityLabel(observation.availability)} ·{' '}
              <time dateTime={observation.observed_at}>
                {relativeTime(observation.observed_at)}
              </time>{' '}
              · {SOURCE_LABELS[observation.source] ?? observation.source}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
