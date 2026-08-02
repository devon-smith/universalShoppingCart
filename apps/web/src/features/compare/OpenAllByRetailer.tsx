'use client';

import { Button } from '@universal-cart/ui';

import type { GroupableItem } from './retailer-groups';
import { groupByRetailer } from './retailer-groups';

/**
 * Open the compared products at their retailers, grouped by site.
 *
 * BUILD_PLAN.md §12.6 asks for this "to reduce tab chaos", and the grouping is the whole
 * point: four saved products opened in save order scatter across four sites, whereas
 * "Open 2 at Northwind" is a thing a person can decide to do. Each button says how many tabs
 * it is about to open, because a control that silently opens four is one people stop trusting.
 *
 * Opening happens on a click and only on a click — `window.open` without a user gesture is
 * what popup blockers exist for, and rightly.
 */
export function OpenAllByRetailer({ items }: { items: readonly GroupableItem[] }) {
  const groups = groupByRetailer(items);
  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="open-all">
      <p className="text-[0.6875rem] font-semibold tracking-[0.06em] text-[var(--uc-foreground-muted)] uppercase">
        Open at the shop
      </p>
      <div className="flex flex-wrap gap-2">
        {groups.map((group) => (
          <Button
            key={group.domain}
            data-testid="open-group"
            data-domain={group.domain}
            onClick={() => {
              // `noopener` on every tab: the opened page must not get a handle on this one.
              for (const url of group.urls) window.open(url, '_blank', 'noopener,noreferrer');
            }}
          >
            Open {group.urls.length} at {group.retailer}
          </Button>
        ))}
      </div>
    </div>
  );
}
