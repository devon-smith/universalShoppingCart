/**
 * Which items are being compared, as a value that survives a reload.
 *
 * The selection lives in the URL (`/app/compare?items=a,b,c`) rather than in component state,
 * for three reasons that all matter more than the convenience of `useState`: a comparison is
 * a thing you send someone, it should survive a refresh mid-decision, and the back button
 * should undo it. BUILD_PLAN.md §12.1 names the route for the same reason.
 *
 * Pure string handling, so both the client tray and the server route parse identically —
 * a route that accepted ids the tray could not produce would be a bug waiting for a stray
 * query string.
 */

import { MAX_COMPARE_ITEMS, MIN_COMPARE_ITEMS } from './compare';

/** Postgres `uuid`, which is what every item id is. Anything else never reaches a query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a selection out of a query parameter.
 *
 * Validates rather than trusts: the value is user-controlled and goes on to build a database
 * query, so anything that is not a uuid is dropped instead of being passed along. Duplicates
 * collapse — comparing an item with itself is not a comparison — and the list is capped at
 * {@link MAX_COMPARE_ITEMS}, so a hand-edited URL asking for forty items gets four rather
 * than an error or forty columns.
 *
 * Order is preserved, because the columns should read in the order the link asked for.
 */
export function parseSelection(raw: string | string[] | undefined): string[] {
  const text = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const seen = new Set<string>();

  for (const candidate of text.split(',')) {
    const id = candidate.trim().toLowerCase();
    if (UUID.test(id)) seen.add(id);
    if (seen.size >= MAX_COMPARE_ITEMS) break;
  }

  return [...seen];
}

/**
 * Parse a selection from an arbitrary caller-supplied value, not just a URL parameter.
 *
 * A Server Action receives its selection as a real `string[]` of individual ids, which
 * {@link parseSelection} would misread: built for the URL contract, it treats an array as a
 * repeated query parameter and reads only the first. Joining to the comma-separated form runs
 * the same validate/dedupe/cap path for both callers. Anything that is not a string or array of
 * strings yields an empty selection rather than throwing.
 */
export function parseSelectionInput(raw: unknown): string[] {
  if (Array.isArray(raw)) return parseSelection(raw.map(String).join(','));
  if (typeof raw === 'string') return parseSelection(raw);
  return [];
}

/** The query-parameter value for a selection. */
export function serializeSelection(ids: readonly string[]): string {
  return ids.join(',');
}

/** The compare route for a selection, or null when there is nothing to compare yet. */
export function compareHref(ids: readonly string[]): string | null {
  if (ids.length < MIN_COMPARE_ITEMS) return null;
  return `/app/compare?items=${serializeSelection(ids.slice(0, MAX_COMPARE_ITEMS))}`;
}

/** Toggle one id, refusing to grow past the maximum. Returns a new array. */
export function toggleSelection(current: readonly string[], id: string): string[] {
  if (current.includes(id)) return current.filter((entry) => entry !== id);
  if (current.length >= MAX_COMPARE_ITEMS) return [...current];
  return [...current, id];
}
