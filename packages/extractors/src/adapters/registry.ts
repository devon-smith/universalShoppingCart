import type { ExtractionContext, ProductExtractor } from '../core/types';

import { bigCommerceAdapter } from './bigcommerce';
import { magentoAdapter } from './magento';
import { salesforceCommerceCloudAdapter } from './salesforce-commerce-cloud';
import { shopifyAdapter } from './shopify';
import { stockxAdapter } from './stockx';
import { wooCommerceAdapter } from './woocommerce';

/**
 * The retailer adapter registry (BUILD_PLAN.md §10.7).
 *
 * Adapters target commerce *platforms*, not brands: a platform's markup is stable across
 * the thousands of storefronts running it, so one adapter with two fixtures covers far more
 * real pages than one adapter per shop — and it can be written and regression-tested
 * without ever fetching a live retailer page.
 *
 * `stockx` is the deliberate exception, and the bar it had to clear is written in its own
 * file: the site runs its own front end, hashed CSS-module classes leave no generic selector
 * anything to match, and its `data-testid` hooks are load-bearing for its engineers. A brand
 * adapter needs that much justification, or the registry turns into a list of every shop
 * anyone has ever visited.
 *
 * Every adapter is versioned and bundled. Nothing here is downloaded at runtime and nothing
 * is evaluated from a string (BUILD_PLAN.md §10.7, §17.4).
 *
 * An adapter never has the last word: it contributes fields with evidence like any other
 * extractor, sits above structured data in the source ranking, and the generic pipeline
 * still runs underneath it. When an adapter matches a page but its selectors have rotted,
 * JSON-LD and meta tags fill the gaps, and a thrown adapter is recorded as a failure rather
 * than taking the capture down with it.
 */
export const RETAILER_ADAPTERS: readonly ProductExtractor[] = [
  stockxAdapter,
  shopifyAdapter,
  wooCommerceAdapter,
  magentoAdapter,
  bigCommerceAdapter,
  salesforceCommerceCloudAdapter,
];

export interface AdapterDescriptor {
  id: string;
  version: string;
  priority: number;
}

/** The registry as plain data, for diagnostics and for the docs to stay honest. */
export function adapterDescriptors(): AdapterDescriptor[] {
  return RETAILER_ADAPTERS.map(({ id, version, priority }) => ({ id, version, priority }));
}

/**
 * Which adapters claim a page.
 *
 * More than one can: a store can run a platform behind a theme that also ships another
 * platform's markers. They are returned highest priority first, and a `supports()` that
 * throws is treated as "no" — the caller records the failure.
 */
export function adaptersFor(context: ExtractionContext): ProductExtractor[] {
  return [...RETAILER_ADAPTERS]
    .sort((a, b) => b.priority - a.priority)
    .filter((adapter) => {
      try {
        return adapter.supports(context);
      } catch {
        return false;
      }
    });
}
