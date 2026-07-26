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
    throw new CaptureError(
      `Could not read this page. ${error instanceof Error ? error.message : String(error)}`,
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
