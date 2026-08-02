import { describe, expect, it, vi } from 'vitest';

import { CAPTURE_FAILED, CAPTURE_READY, EXTRACT_RESPONSE } from '../messaging/protocol';

import type { InvocationDeps } from './invoke';
import { NO_TAB_MESSAGE, captureFromInvocation } from './invoke';
import { PENDING_CAPTURE_KEY } from './pending';
import { PERMISSION_HELP } from './request';

function deps(overrides: Partial<InvocationDeps> = {}) {
  const data: Record<string, unknown> = {};
  const notified: unknown[] = [];
  const opened: number[] = [];

  const base: InvocationDeps = {
    scripting: { executeScript: () => Promise.resolve([]) },
    tabs: {
      sendMessage: (_tabId, message) =>
        Promise.resolve({
          schemaVersion: 1,
          type: EXTRACT_RESPONSE,
          requestId: (message as { requestId: string }).requestId,
          result: { ok: true, capture: { schemaVersion: 1 } },
        }),
    },
    store: {
      get: (key) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
      set: (items) => {
        Object.assign(data, items);
        return Promise.resolve();
      },
      remove: (key) => {
        delete data[key];
        return Promise.resolve();
      },
    },
    openPanel: (id) => opened.push(id),
    notify: (message) => notified.push(message),
    ...overrides,
  };

  return { deps: base, data, notified, opened };
}

describe('captureFromInvocation', () => {
  it('leaves the capture where the panel will find it and says so', async () => {
    const { deps: d, data, notified } = deps();

    const outcome = await captureFromInvocation(42, d);

    expect(outcome).toEqual({ ok: true });
    expect(data[PENDING_CAPTURE_KEY]).toMatchObject({ tabId: 42 });
    expect(notified).toContainEqual(expect.objectContaining({ type: CAPTURE_READY }));
  });

  it('opens the panel before awaiting anything, so the user gesture is still valid', async () => {
    const opened: number[] = [];
    let openedBeforeScript = false;

    const { deps: d } = deps({
      openPanel: (id) => opened.push(id),
      scripting: {
        executeScript: () => {
          openedBeforeScript = opened.length > 0;
          return Promise.resolve([]);
        },
      },
    });

    await captureFromInvocation(42, d);

    expect(openedBeforeScript).toBe(true);
  });

  it('reports the actionable permission message when the page cannot be read', async () => {
    const {
      deps: d,
      notified,
      data,
    } = deps({
      scripting: {
        executeScript: () =>
          Promise.reject(
            new Error('Cannot access contents of the page at "https://shop.example".'),
          ),
      },
    });

    const outcome = await captureFromInvocation(42, d);

    expect(outcome).toEqual({ ok: false, reason: 'capture-failed', message: PERMISSION_HELP });
    expect(notified).toContainEqual(
      expect.objectContaining({ type: CAPTURE_FAILED, message: PERMISSION_HELP }),
    );
    expect(data[PENDING_CAPTURE_KEY]).toBeUndefined();
  });

  it('says something useful when the invocation carried no tab', async () => {
    const { deps: d, notified } = deps();
    const executeScript = vi.fn();

    const outcome = await captureFromInvocation(undefined, { ...d, scripting: { executeScript } });

    expect(outcome).toEqual({ ok: false, reason: 'no-tab', message: NO_TAB_MESSAGE });
    expect(executeScript).not.toHaveBeenCalled();
    expect(notified).toContainEqual(expect.objectContaining({ type: CAPTURE_FAILED }));
  });
});
