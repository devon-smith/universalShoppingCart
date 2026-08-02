import { extractProductCapture } from '@universal-cart/extractors';

import { isCapturablePage } from '@/lib/capture/request';
import {
  EXTRACT_RESPONSE,
  isExtractRequest,
  MESSAGE_SCHEMA_VERSION,
} from '@/lib/messaging/protocol';

/**
 * The capture script.
 *
 * Unlisted: it is not registered in the manifest and matches no host. The side panel
 * injects it with `chrome.scripting.executeScript` under `activeTab`, which means it can
 * only ever run on a tab the user has just activated the extension on
 * (BUILD_PLAN.md §11.1).
 *
 * It reads the DOM, runs the extraction pipeline, and returns a serializable capture.
 * It reads no cookies, records no unrelated page text, sends nothing anywhere on its own,
 * and does not mutate the page.
 *
 * The "may this page be read at all" check lives here rather than in the panel, because
 * only code running on the page can see its URL: with `activeTab` alone the extension has
 * no way to read tab URLs, and asking for the `tabs` permission to perform the check
 * would mean reading every tab's URL in order to decline to read one of them.
 */
const READY_FLAG = '__universalCartCaptureReady';

export default defineUnlistedScript(() => {
  // Injection is idempotent: a second capture on the same page must not add a second
  // listener, which would make the page answer twice.
  const scope = globalThis as unknown as Record<string, boolean>;
  if (scope[READY_FLAG]) return;
  scope[READY_FLAG] = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isExtractRequest(message)) return false;

    const url = window.location.href;

    const result = isCapturablePage(url)
      ? extractProductCapture({ document, url })
      : {
          ok: false as const,
          issues: ['This page cannot be captured. Open a product page and try again.'],
          draft: null,
          extractorFailures: [],
        };

    sendResponse({
      schemaVersion: MESSAGE_SCHEMA_VERSION,
      type: EXTRACT_RESPONSE,
      requestId: message.requestId,
      result,
    });

    return false;
  });
});
