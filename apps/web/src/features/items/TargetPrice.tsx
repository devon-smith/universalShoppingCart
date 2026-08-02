'use client';

import { StatusBadge } from '@universal-cart/ui';

import { formatMoney } from './format';
import type { HistorySummary } from './history';
import type { SavedItem } from './query';
import { targetEverReached, targetProgress, targetState } from './target';

/**
 * The price you said you would pay, and how far away it is.
 *
 * Arithmetic on two stored numbers and nothing else. No forecast, no "likely to drop", no
 * "similar items are cheaper" — the product has no evidence for any of that and inventing it
 * here would undo the care taken everywhere else.
 *
 * Green means one thing: an observation recorded the price at or below the target. The bar and
 * the words carry the same meaning without it, so colour is never the only signal (WCAG 1.4.1).
 */
export function TargetPrice({ item, summary }: { item: SavedItem; summary: HistorySummary }) {
  const state = targetState(item.desired_price, item.current_price);
  if (state.kind === 'none') return null;

  const money = (amount: string) => formatMoney(amount, item.currency) ?? amount;
  const progress = targetProgress(item.desired_price, item.current_price, summary);
  // A target met earlier and since exceeded is a different fact from one met now, and worth
  // saying — it tells you the price does go there.
  const everReached = targetEverReached(item.desired_price, summary);

  return (
    <div className="flex flex-col gap-2" data-testid="target-price" data-state={state.kind}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-[var(--uc-foreground-muted)]">
          Your target: <span className="font-semibold tabular-nums">{money(state.target)}</span>
        </span>

        {state.kind === 'reached' ? (
          <StatusBadge tone="success">
            <span aria-hidden="true">✓</span> At or below your target
          </StatusBadge>
        ) : state.kind === 'above' ? (
          <span className="text-sm tabular-nums text-[var(--uc-foreground-muted)]">
            {money(state.gap)} above
            {state.percentOver !== null ? ` (${state.percentOver}%)` : ''}
          </span>
        ) : null}
      </div>

      {progress !== null ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-[var(--uc-radius-pill)] bg-[var(--uc-surface-muted)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label={
            state.kind === 'reached'
              ? 'Target reached'
              : `${Math.round(progress * 100)}% of the way from the highest price seen to your target`
          }
        >
          <div
            className="h-full rounded-[var(--uc-radius-pill)]"
            style={{
              width: `${Math.round(progress * 100)}%`,
              background: state.kind === 'reached' ? 'var(--uc-success)' : 'var(--uc-primary)',
            }}
          />
        </div>
      ) : null}

      {state.kind === 'no-price' ? (
        <p className="text-xs text-[var(--uc-foreground-muted)]">
          No price has been observed yet, so there is nothing to measure against.
        </p>
      ) : null}

      {state.kind === 'above' && everReached ? (
        <p className="text-xs text-[var(--uc-foreground-muted)]">
          It has been at or below your target before — {money(summary.lowest!.amount)} was the
          lowest observed.
        </p>
      ) : null}
    </div>
  );
}
