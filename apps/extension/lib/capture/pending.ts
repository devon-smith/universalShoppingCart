import type { ExtractionResult } from '@universal-cart/extractors';

/**
 * A capture taken by the background worker, waiting for the side panel to collect it.
 *
 * The context-menu and keyboard paths run extraction *before* the panel is necessarily
 * open, because only those invocations hold `activeTab` for the tab in question (see
 * lib/manifest.ts, CAPTURE_INVOCATIONS). The result therefore has to survive the gap
 * between the invocation and the panel mounting — and MV3 stops service workers freely,
 * so it cannot simply live in a variable (BUILD_PLAN.md §11.2).
 *
 * Session storage, not local: a pending capture is a handoff, not a record. It should not
 * outlive the browser session, and nothing here is worth persisting to disk.
 */

export const PENDING_CAPTURE_KEY = 'universal-cart/pending-capture';

/** How long a handoff stays collectable. */
export const PENDING_CAPTURE_MAX_AGE_MS = 5 * 60 * 1000;

export const PENDING_CAPTURE_SCHEMA_VERSION = 1 as const;

export interface PendingCapture {
  schemaVersion: typeof PENDING_CAPTURE_SCHEMA_VERSION;
  result: ExtractionResult;
  tabId: number;
  capturedAt: string;
}

/** The `chrome.storage.session` surface this flow uses. */
export interface PendingStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Validate anything read back out of storage.
 *
 * An extension update can leave a handoff written by an older build sitting in session
 * storage. Recognising it as incompatible beats half-understanding it.
 */
export function isPendingCapture(value: unknown): value is PendingCapture {
  if (typeof value !== 'object' || value === null) return false;
  const pending = value as Partial<PendingCapture>;
  return (
    pending.schemaVersion === PENDING_CAPTURE_SCHEMA_VERSION &&
    typeof pending.tabId === 'number' &&
    typeof pending.capturedAt === 'string' &&
    typeof pending.result === 'object' &&
    pending.result !== null
  );
}

export function pendingCapture(
  result: ExtractionResult,
  tabId: number,
  now: Date = new Date(),
): PendingCapture {
  return {
    schemaVersion: PENDING_CAPTURE_SCHEMA_VERSION,
    result,
    tabId,
    capturedAt: now.toISOString(),
  };
}

export async function putPendingCapture(
  store: PendingStore,
  capture: PendingCapture,
): Promise<void> {
  await store.set({ [PENDING_CAPTURE_KEY]: capture });
}

/**
 * Collect the pending capture, if there is a fresh one, and clear it.
 *
 * One-shot by design: the panel should show a capture the user just asked for, never
 * re-show a stale one when it happens to remount.
 */
export async function takePendingCapture(
  store: PendingStore,
  now: Date = new Date(),
): Promise<PendingCapture | null> {
  const stored = await store.get(PENDING_CAPTURE_KEY);
  const value = stored[PENDING_CAPTURE_KEY];

  if (!isPendingCapture(value)) {
    if (value !== undefined) await store.remove(PENDING_CAPTURE_KEY);
    return null;
  }

  await store.remove(PENDING_CAPTURE_KEY);

  const age = now.getTime() - new Date(value.capturedAt).getTime();
  if (!Number.isFinite(age) || age < 0 || age > PENDING_CAPTURE_MAX_AGE_MS) return null;

  return value;
}
