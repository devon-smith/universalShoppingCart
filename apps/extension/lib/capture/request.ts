import type { ExtractionResult } from '@universal-cart/extractors';

import { extractRequest, isExtractResponse } from '../messaging/protocol';

/**
 * Ask the current tab for a capture.
 *
 * Extraction happens only after an explicit user action, on the tab the user is looking
 * at, using `activeTab` (BUILD_PLAN.md §11.1, §17.1). There is no content script in the
 * manifest and no host permission: the capture script is injected on demand and can only
 * reach a tab the user has just activated the extension on.
 *
 * The browser APIs are parameters so the whole flow — including its failure paths — is
 * testable without a browser.
 */

/** The `chrome.scripting` surface this flow uses. */
export interface ScriptingApi {
  executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
}

/** The `chrome.tabs` surface this flow uses. */
export interface TabsApi {
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export const CAPTURE_SCRIPT_FILE = 'capture.js';

export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}

/**
 * Chrome's wording when the extension does not hold `activeTab` for the tab.
 *
 * Matched rather than parsed: the string is an internal detail and may change, so a miss
 * falls through to the generic message rather than to something wrong.
 */
const PERMISSION_DENIED =
  /cannot access contents of|must request permission|cannot access a chrome|extension manifest/i;

/**
 * What to tell the user when access was refused.
 *
 * Chrome's own message ("Cannot access contents of the page…") describes the mechanism and
 * gives no way out. The user's problem is not that a permission is missing, it is that the
 * grant expired when they navigated — and the fix is a different gesture, not a setting.
 */
export const PERMISSION_HELP =
  'Universal Cart needs your go-ahead for this page. Right-click anywhere on it and choose ' +
  '“Save to Universal Cart”, or press ⌘⇧U (Ctrl+Shift+U on Windows). Chrome only lets the ' +
  'extension read a page when you invoke it there, and that permission ends as soon as the ' +
  'page navigates — which is why the panel button alone cannot do it.';

/** Pages the extension must not read (BUILD_PLAN.md §17.1). */
export function isCapturablePage(url: string | undefined): boolean {
  if (!url) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  // Checkout, account, and payment pages are never inspected, even on a retailer the user
  // is actively shopping. There is nothing on them this product needs.
  const path = parsed.pathname.toLowerCase();
  const FORBIDDEN = [
    '/checkout',
    '/payment',
    '/billing',
    '/account',
    '/signin',
    '/login',
    '/order',
  ];
  return !FORBIDDEN.some((segment) => path.startsWith(segment) || path.includes(`${segment}/`));
}

export interface RequestCaptureDeps {
  scripting: ScriptingApi;
  tabs: TabsApi;
  tabId: number;
  /** Injected so a test can pin the correlation id. */
  newRequestId?: () => string;
}

export async function requestCapture(deps: RequestCaptureDeps): Promise<ExtractionResult> {
  const requestId = (deps.newRequestId ?? (() => crypto.randomUUID()))();

  try {
    // Idempotent: the script no-ops if it is already listening on this page.
    await deps.scripting.executeScript({
      target: { tabId: deps.tabId },
      files: [CAPTURE_SCRIPT_FILE],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CaptureError(
      PERMISSION_DENIED.test(detail) ? PERMISSION_HELP : `Could not read this page. ${detail}`,
    );
  }

  let response: unknown;
  try {
    response = await deps.tabs.sendMessage(deps.tabId, extractRequest(requestId));
  } catch (error) {
    throw new CaptureError(
      `The page did not answer. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isExtractResponse(response, requestId)) {
    throw new CaptureError('The page returned an unrecognized response.');
  }

  return response.result;
}
