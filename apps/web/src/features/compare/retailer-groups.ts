/**
 * Group items by retailer, for the "Open all by retailer" action (BUILD_PLAN.md §12.6).
 *
 * Opening four saved products means four tabs; grouping them by retailer lets the dashboard
 * open one retailer's pages together and label the action honestly ("Open 2 at Zara") rather
 * than spraying tabs in save order. Pure and view-agnostic: the UI decides how to open them.
 */

export interface GroupableItem {
  id: string;
  retailer_name: string;
  domain: string;
  /** The page to open — the URL as visited, which is what the user saw. */
  source_url: string;
}

export interface RetailerGroup {
  retailer: string;
  domain: string;
  itemIds: string[];
  /** One per item, in input order; duplicates are kept — two variants are two pages. */
  urls: string[];
}

/**
 * Partition items into per-retailer groups.
 *
 * Grouped by `domain` rather than display name, because two storefronts can share a name
 * while a single retailer can span domains, and the domain is what actually determines which
 * site a tab opens. Group order follows first appearance, and items within a group keep their
 * input order, so the result is deterministic and reads the way the list did. Only http(s)
 * URLs are included — a stored value that is not a real web address is not a tab to open.
 */
export function groupByRetailer(items: readonly GroupableItem[]): RetailerGroup[] {
  const groups = new Map<string, RetailerGroup>();

  for (const item of items) {
    if (!/^https?:\/\//i.test(item.source_url)) continue;

    const key = item.domain.trim().toLowerCase();
    if (key.length === 0) continue;

    let group = groups.get(key);
    if (!group) {
      group = { retailer: item.retailer_name, domain: item.domain, itemIds: [], urls: [] };
      groups.set(key, group);
    }
    group.itemIds.push(item.id);
    group.urls.push(item.source_url);
  }

  return [...groups.values()];
}
