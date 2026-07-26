import { describe, expect, it, vi } from 'vitest';

import { EXTRACT_RESPONSE, MESSAGE_SCHEMA_VERSION } from '../messaging/protocol';

import type { ScriptingApi, TabsApi } from './request';
import { CAPTURE_SCRIPT_FILE, CaptureError, isCapturablePage, requestCapture } from './request';

const RESULT = { ok: true, capture: {}, contributors: [], extractorFailures: [] };

function deps(overrides: { scripting?: Partial<ScriptingApi>; tabs?: Partial<TabsApi> } = {}) {
  const scripting: ScriptingApi = {
    executeScript: vi.fn(async () => []),
    ...overrides.scripting,
  };
  const tabs: TabsApi = {
    sendMessage: vi.fn(async (_tabId: number, message: unknown) => ({
      schemaVersion: MESSAGE_SCHEMA_VERSION,
      type: EXTRACT_RESPONSE,
      requestId: (message as { requestId: string }).requestId,
      result: RESULT,
    })),
    ...overrides.tabs,
  };

  return { scripting, tabs, tabId: 7, newRequestId: () => 'req-1' };
}

describe('isCapturablePage', () => {
  it('accepts ordinary product pages', () => {
    expect(isCapturablePage('https://shop.example/products/1')).toBe(true);
    expect(isCapturablePage('http://shop.example/p/1')).toBe(true);
  });

  it('rejects browser and extension pages', () => {
    expect(isCapturablePage('chrome://extensions')).toBe(false);
    expect(isCapturablePage('chrome-extension://abc/sidepanel.html')).toBe(false);
    expect(isCapturablePage('about:blank')).toBe(false);
    expect(isCapturablePage('file:///home/user/page.html')).toBe(false);
    expect(isCapturablePage(undefined)).toBe(false);
  });

  it('refuses to inspect checkout, payment, and account pages', () => {
    // A firm promise in the privacy policy, not a heuristic.
    expect(isCapturablePage('https://shop.example/checkout')).toBe(false);
    expect(isCapturablePage('https://shop.example/checkout/payment')).toBe(false);
    expect(isCapturablePage('https://shop.example/account/orders')).toBe(false);
    expect(isCapturablePage('https://shop.example/billing')).toBe(false);
    expect(isCapturablePage('https://shop.example/login')).toBe(false);
  });

  it('does not reject a product whose name merely contains a forbidden word', () => {
    expect(isCapturablePage('https://shop.example/products/checkout-counter-mat')).toBe(true);
  });
});

describe('requestCapture', () => {
  it('injects the capture script and returns the result', async () => {
    const d = deps();
    await expect(requestCapture(d)).resolves.toEqual(RESULT);

    expect(d.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: [CAPTURE_SCRIPT_FILE],
    });
  });

  it('correlates the response to its request', async () => {
    const d = deps();
    await requestCapture(d);

    expect(d.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ requestId: 'req-1' }),
    );
  });

  it('rejects a response carrying a different request id', async () => {
    const d = deps({
      tabs: {
        sendMessage: vi.fn(async () => ({
          schemaVersion: MESSAGE_SCHEMA_VERSION,
          type: EXTRACT_RESPONSE,
          requestId: 'someone-elses-request',
          result: RESULT,
        })),
      },
    });

    await expect(requestCapture(d)).rejects.toThrow(/unrecognized response/);
  });

  it('tells the user how to authorize the page instead of leaking Chrome’s wording', async () => {
    // Chrome's own string names the mechanism and offers no way out. The user's problem is
    // that the `activeTab` grant expired when they navigated, and the fix is a different
    // gesture — so say that instead.
    const d = deps({
      scripting: {
        executeScript: vi.fn(async () => {
          throw new Error('Cannot access contents of the page');
        }),
      },
    });

    await expect(requestCapture(d)).rejects.toThrow(CaptureError);
    await expect(requestCapture(d)).rejects.toThrow(/Save to Universal Cart/);
  });

  it('explains any other injection failure instead of hanging', async () => {
    const d = deps({
      scripting: {
        executeScript: vi.fn(async () => {
          throw new Error('Frame with ID 0 was removed.');
        }),
      },
    });

    await expect(requestCapture(d)).rejects.toThrow(CaptureError);
    await expect(requestCapture(d)).rejects.toThrow(/Could not read this page/);
    await expect(requestCapture(d)).rejects.toThrow(/Frame with ID 0/);
  });

  it('explains a silent page', async () => {
    const d = deps({
      tabs: {
        sendMessage: vi.fn(async () => {
          throw new Error('Receiving end does not exist');
        }),
      },
    });

    await expect(requestCapture(d)).rejects.toThrow(/did not answer/);
  });

  it('does not message the page when injection failed', async () => {
    const d = deps({
      scripting: {
        executeScript: vi.fn(async () => {
          throw new Error('nope');
        }),
      },
    });

    await expect(requestCapture(d)).rejects.toThrow(CaptureError);
    expect(d.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
