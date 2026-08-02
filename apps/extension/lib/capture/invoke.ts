import { captureFailed, captureReady } from '../messaging/protocol';

import type { PendingStore } from './pending';
import { pendingCapture, putPendingCapture } from './pending';
import type { ScriptingApi, TabsApi } from './request';
import { requestCapture } from './request';

/**
 * Capture driven by a context-menu click or the keyboard shortcut.
 *
 * These run in the background worker rather than the panel for one reason: they are
 * *action invocations*, so they hold `activeTab` for the tab the user is looking at. A
 * button inside the side panel does not (lib/manifest.ts, CAPTURE_INVOCATIONS).
 *
 * The panel is opened first and awaited on nothing, because `chrome.sidePanel.open()` is
 * only valid while the user gesture is live and an `await` spends it. The capture then
 * lands in session storage and the panel is told to collect it — whichever of the two
 * happens first, the panel finds the result.
 *
 * Browser APIs are parameters so the whole flow, including its failure paths, is testable
 * without a browser — which is exactly the gap that let this bug ship.
 */

export interface InvocationDeps {
  scripting: ScriptingApi;
  tabs: TabsApi;
  store: PendingStore;
  /** Opens the side panel. Called before any await so the user gesture is still valid. */
  openPanel(tabId: number): void;
  /** Tells an already-open panel to collect the result. Best-effort. */
  notify(message: unknown): void;
  now?: () => Date;
  newRequestId?: () => string;
}

export type InvocationOutcome =
  { ok: true } | { ok: false; reason: 'no-tab' | 'capture-failed'; message: string };

export const NO_TAB_MESSAGE = 'Universal Cart could not tell which tab to read.';

export async function captureFromInvocation(
  tabId: number | undefined,
  deps: InvocationDeps,
): Promise<InvocationOutcome> {
  if (typeof tabId !== 'number') {
    deps.notify(captureFailed(NO_TAB_MESSAGE));
    return { ok: false, reason: 'no-tab', message: NO_TAB_MESSAGE };
  }

  deps.openPanel(tabId);

  try {
    const result = await requestCapture({
      scripting: deps.scripting,
      tabs: deps.tabs,
      tabId,
      ...(deps.newRequestId ? { newRequestId: deps.newRequestId } : {}),
    });

    await putPendingCapture(deps.store, pendingCapture(result, tabId, deps.now?.() ?? new Date()));
    deps.notify(captureReady());

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.notify(captureFailed(message));
    return { ok: false, reason: 'capture-failed', message };
  }
}
