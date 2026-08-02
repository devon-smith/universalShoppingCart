/**
 * The comparison core: turn 2–4 saved items into a structured, view-agnostic comparison.
 *
 * This is pure logic — no React, no formatting decisions beyond what is needed to compare.
 * The compare view renders the {@link Comparison} it returns; keeping the two apart is what
 * lets the hard rules live in one tested place instead of scattered through JSX.
 *
 * Two of those rules shape the whole structure:
 *
 * 1. **Never assert a fact the data does not support.** A row is `comparable` only when
 *    agreement across items is meaningful. Price and availability are: one item really is
 *    cheaper, really is in stock. Size and colour are NOT — a Zara "M" and a Nike "M" are
 *    different garments, and highlighting them as "the same" is exactly the invented fact
 *    CLAUDE.md forbids. Variant rows are therefore never comparable, and carry no agreement
 *    or lowest-price flags.
 *
 * 2. **Money is compared exactly, and only within one currency.** Amounts stay decimal
 *    strings and never touch a float. "Cheapest" across a mix of USD and EUR is undefined
 *    without a rate this project does not have, so a mixed-currency set reports no lowest at
 *    all rather than a guess.
 */

import type { ItemAvailability, PriceSummary, SavedItem } from '../items/query';

/** A saved item plus fields the row type may not yet carry. */
export type CompareItem = SavedItem & {
  product_availability?: ItemAvailability | null;
  /** Raw fibre content, un-normalized (docs/DECISIONS.md, 2026-08-02). */
  composition?: string | null;
};

export interface CompareInput {
  item: CompareItem;
  /** From `item_price_summary`; enables the price-change row. Absent is fine. */
  summary?: PriceSummary | null;
}

/**
 * One item's value in one row.
 *
 * `present` is the single source of truth for "absent" — a missing value is shown as
 * missing, never inferred. Money cells additionally carry the raw `amount` and `currency`
 * so the view can render them through the `Price` primitive rather than a pre-formatted
 * string. `annotations` are per-cell marks the view may surface: `lowest`, `on-sale`,
 * `below-target`, `price-drop`, `price-rise`.
 */
export interface CompareCell {
  itemId: string;
  present: boolean;
  /** A plain-text representation, for scalar rows and as a fallback. */
  text: string | null;
  amount?: string | null;
  currency?: string | null;
  annotations: string[];
}

export type RowKind = 'image' | 'scalar' | 'money' | 'availability' | 'variant' | 'note';

export interface CompareRow {
  key: string;
  label: string;
  kind: RowKind;
  /** One cell per input item, in input order. */
  cells: CompareCell[];
  /**
   * Whether comparing values across items is meaningful. False for descriptive rows —
   * variant options, notes, images — where cross-item agreement asserts nothing true.
   */
  comparable: boolean;
  /** For comparable rows: do all *present* cells share a value? Undefined when not comparable. */
  allAgree?: boolean;
  /** For money rows within one currency: the item ids carrying the lowest price. */
  lowestItemIds?: string[];
}

export interface Comparison {
  items: { id: string; title: string }[];
  rows: CompareRow[];
  /** True when the set spans more than one currency, so "lowest price" is undefined. */
  mixedCurrency: boolean;
}

export const MIN_COMPARE_ITEMS = 2;
export const MAX_COMPARE_ITEMS = 4;

/** Exact comparison of two decimal strings, without floating point. */
function decimalCompare(a: string, b: string): number {
  const norm = (value: string) => {
    const negative = value.startsWith('-');
    const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
    return { negative, whole, fraction };
  };
  const left = norm(a);
  const right = norm(b);
  if (left.negative !== right.negative) return left.negative ? -1 : 1;
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const li = BigInt(left.whole + left.fraction.padEnd(scale, '0'));
  const ri = BigInt(right.whole + right.fraction.padEnd(scale, '0'));
  const raw = li === ri ? 0 : li < ri ? -1 : 1;
  return left.negative ? -raw : raw;
}

/** A money value as a normalized decimal string, or null. Never a float. */
function moneyString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (text.length === 0) return null;
  // Accept a plain decimal; reject anything else rather than coerce.
  return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
}

function cell(itemId: string, text: string | null, annotations: string[] = []): CompareCell {
  return { itemId, present: text !== null && text !== '', text, annotations };
}

function moneyCell(
  itemId: string,
  amount: string | null,
  currency: string | null,
  annotations: string[] = [],
): CompareCell {
  return { itemId, present: amount !== null, text: amount, amount, currency, annotations };
}

/** Do all present cells carry the same text? Vacuously true only matters for comparable rows. */
function agreement(cells: readonly CompareCell[]): boolean {
  const present = cells.filter((c) => c.present).map((c) => c.text);
  if (present.length < 2) return present.length === 1;
  return present.every((value) => value === present[0]);
}

const AVAILABILITY_LABEL: Record<ItemAvailability, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Out of stock',
  preorder: 'Preorder',
  backorder: 'Backorder',
  unknown: 'Unknown',
};

function imageRow(inputs: readonly CompareInput[]): CompareRow {
  return {
    key: 'image',
    label: 'Image',
    kind: 'image',
    comparable: false,
    cells: inputs.map(({ item }) => cell(item.id, item.image_url)),
  };
}

function scalarRow(
  key: string,
  label: string,
  inputs: readonly CompareInput[],
  read: (item: CompareItem) => string | null,
  comparable: boolean,
): CompareRow {
  const cells = inputs.map(({ item }) => cell(item.id, read(item)));
  return {
    key,
    label,
    kind: 'scalar',
    comparable,
    cells,
    ...(comparable ? { allAgree: agreement(cells) } : {}),
  };
}

function priceRow(inputs: readonly CompareInput[], mixedCurrency: boolean): CompareRow {
  const cells = inputs.map(({ item }) =>
    moneyCell(item.id, moneyString(item.current_price), item.currency),
  );

  // "Cheapest" is only meaningful within one currency; a mixed set gets no lowest mark.
  let lowestItemIds: string[] = [];
  if (!mixedCurrency) {
    const priced = cells.filter((c) => c.amount !== null);
    if (priced.length >= 2) {
      const min = priced.reduce((a, b) => (decimalCompare(a.amount!, b.amount!) <= 0 ? a : b));
      lowestItemIds = priced
        .filter((c) => decimalCompare(c.amount!, min.amount!) === 0)
        .map((c) => c.itemId);
      // A tie among every priced item is not a saving worth marking.
      if (lowestItemIds.length === priced.length) lowestItemIds = [];
    }
  }

  for (const c of cells) {
    if (lowestItemIds.includes(c.itemId)) c.annotations.push('lowest');
  }

  return { key: 'price', label: 'Price', kind: 'money', comparable: true, cells, lowestItemIds };
}

function originalPriceRow(inputs: readonly CompareInput[]): CompareRow | null {
  const cells = inputs.map(({ item }) => {
    const original = moneyString(item.original_price);
    const current = moneyString(item.current_price);
    // A former price only counts when it is genuinely above the current one — otherwise it
    // is not a discount, and showing it would fabricate a saving.
    const valid = original !== null && (current === null || decimalCompare(original, current) > 0);
    return moneyCell(item.id, valid ? original : null, item.currency, valid ? ['on-sale'] : []);
  });

  // Omit the row entirely when no item is genuinely on sale.
  if (!cells.some((c) => c.present)) return null;

  return {
    key: 'original',
    label: 'Was',
    kind: 'money',
    comparable: false,
    cells,
  };
}

function priceChangeRow(inputs: readonly CompareInput[]): CompareRow | null {
  const cells = inputs.map(({ item, summary }) => {
    const latest = moneyString(summary?.latest_price);
    const previous = moneyString(summary?.previous_price);
    if (latest === null || previous === null) return cell(item.id, null);

    const direction = decimalCompare(latest, previous);
    if (direction === 0) return cell(item.id, null);

    const annotation = direction < 0 ? 'price-drop' : 'price-rise';
    const arrow = direction < 0 ? '▼' : '▲';
    return {
      ...cell(item.id, `${arrow} ${previous} → ${latest}`, [annotation]),
      amount: latest,
      currency: item.currency,
    };
  });

  if (!cells.some((c) => c.present)) return null;

  return {
    key: 'price-change',
    label: 'Since you saved it',
    kind: 'money',
    comparable: false,
    cells,
  };
}

function availabilityRow(inputs: readonly CompareInput[]): CompareRow {
  const cells = inputs.map(({ item }) => {
    const annotations: string[] = [];
    // The product-level claim is surfaced only when it differs from the variant's — "your
    // size is gone, the product is still sold". By construction of the ingestion function,
    // product_availability is non-null only in that case.
    if (item.product_availability != null && item.product_availability !== item.availability) {
      annotations.push(`product:${item.product_availability}`);
    }
    return cell(item.id, AVAILABILITY_LABEL[item.availability], annotations);
  });

  return {
    key: 'availability',
    label: 'Availability',
    kind: 'availability',
    comparable: true,
    cells,
    allAgree: agreement(cells),
  };
}

function variantRows(inputs: readonly CompareInput[]): CompareRow[] {
  // The union of option names across items, first-seen order preserved so the rows read in
  // the order the pages presented them.
  const keys: string[] = [];
  for (const { item } of inputs) {
    for (const name of Object.keys(item.selected_variant ?? {})) {
      if (!keys.includes(name)) keys.push(name);
    }
  }

  return keys.map((name) => ({
    key: `variant.${name}`,
    label: name,
    kind: 'variant' as const,
    // Never comparable: two retailers' "M" are not the same size, and asserting agreement
    // across them is the invented fact this product must not produce.
    comparable: false,
    cells: inputs.map(({ item }) => cell(item.id, item.selected_variant?.[name] ?? null)),
  }));
}

function desiredPriceRow(inputs: readonly CompareInput[]): CompareRow | null {
  const cells = inputs.map(({ item }) => {
    const desired = moneyString(item.desired_price);
    if (desired === null) return moneyCell(item.id, null, item.currency);
    const current = moneyString(item.current_price);
    const met = current !== null && decimalCompare(current, desired) <= 0;
    return moneyCell(item.id, desired, item.currency, met ? ['below-target'] : []);
  });

  if (!cells.some((c) => c.present)) return null;

  return {
    key: 'desired-price',
    label: 'Target price',
    kind: 'money',
    // Each user target is its own number; comparing them across items asserts nothing.
    comparable: false,
    cells,
  };
}

function compositionRow(inputs: readonly CompareInput[]): CompareRow | null {
  const cells = inputs.map(({ item }) => cell(item.id, item.composition ?? null));
  if (!cells.some((c) => c.present)) return null;
  return {
    key: 'composition',
    label: 'Composition',
    kind: 'scalar',
    // Not comparable while the strings are raw: two garments both "100% cotton" is a real
    // shared fact, but the tool cannot assert "100% cotton" and "Cotton 100%" agree until
    // the strings are normalized (docs/DECISIONS.md, 2026-08-02). Asserting it on raw text
    // would fabricate a match — non-comparable is the honest setting until then.
    comparable: false,
    cells,
  };
}

function noteRow(inputs: readonly CompareInput[]): CompareRow | null {
  const cells = inputs.map(({ item }) => cell(item.id, item.note));
  if (!cells.some((c) => c.present)) return null;
  return { key: 'note', label: 'Notes', kind: 'note', comparable: false, cells };
}

/**
 * Build a comparison over 2–4 items.
 *
 * Throws outside that range: fewer than two is not a comparison, and more than four stops
 * being one a person can read at a glance (BUILD_PLAN.md §12.5). Rows that no item populates
 * are omitted, so a set with no sale prices simply has no "Was" row.
 */
export function compareItems(inputs: readonly CompareInput[]): Comparison {
  if (inputs.length < MIN_COMPARE_ITEMS || inputs.length > MAX_COMPARE_ITEMS) {
    throw new RangeError(
      `Compare ${MIN_COMPARE_ITEMS}–${MAX_COMPARE_ITEMS} items, not ${inputs.length}.`,
    );
  }

  const currencies = new Set(
    inputs
      .map(({ item }) => (item.currency ?? '').trim().toUpperCase())
      .filter((code) => code.length > 0),
  );
  const mixedCurrency = currencies.size > 1;

  const rows: CompareRow[] = [
    imageRow(inputs),
    scalarRow('title', 'Product', inputs, (item) => item.title, false),
    scalarRow('retailer', 'Retailer', inputs, (item) => item.retailer_name, true),
    priceRow(inputs, mixedCurrency),
    originalPriceRow(inputs),
    priceChangeRow(inputs),
    availabilityRow(inputs),
    ...variantRows(inputs),
    compositionRow(inputs),
    desiredPriceRow(inputs),
    noteRow(inputs),
  ].filter((row): row is CompareRow => row !== null);

  return {
    items: inputs.map(({ item }) => ({ id: item.id, title: item.title })),
    rows,
    mixedCurrency,
  };
}
