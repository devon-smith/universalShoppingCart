import { describe, expect, it, vi } from 'vitest';

import type { ObservedState } from './alerts';
import {
  processRefreshJob,
  runRefreshCycle,
  type ParsedObservation,
  type RefreshJob,
  type RefreshWorkerDeps,
} from './worker';

const HTML = '<html>ok</html>';

function parsed(over: Partial<ParsedObservation> = {}): ParsedObservation {
  return {
    price: '75.00',
    originalPrice: null,
    currency: 'USD',
    availability: 'in_stock',
    extractorId: 'generic',
    extractorVersion: '1.0.0',
    confidence: 0.9,
    ...over,
  };
}

function job(previous: Partial<ObservedState> = {}): RefreshJob {
  return {
    itemId: 'item-1',
    url: 'https://shop.example/p',
    previous: { availability: 'in_stock', price: '90.00', desiredPrice: null, ...previous },
  };
}

function deps(over: Partial<RefreshWorkerDeps> = {}): RefreshWorkerDeps {
  return {
    fetchHtml: vi.fn(async () => HTML),
    parse: vi.fn(() => parsed()),
    recordObservation: vi.fn(async () => true),
    recordNotification: vi.fn(async () => {}),
    recordResult: vi.fn(async () => {}),
    ...over,
  };
}

describe('processRefreshJob', () => {
  it('records the observation and a successful result on a normal refresh', async () => {
    const d = deps();
    const outcome = await processRefreshJob(job(), d);
    expect(outcome).toMatchObject({ ok: true, observationInserted: true });
    expect(d.recordObservation).toHaveBeenCalledWith('item-1', parsed());
    expect(d.recordResult).toHaveBeenCalledWith('item-1', true);
  });

  it('raises a price_below_desired alert on the crossing, with the price as the value', async () => {
    const d = deps({ parse: () => parsed({ price: '70.00' }) });
    const outcome = await processRefreshJob(job({ price: '90.00', desiredPrice: '80.00' }), d);
    expect(outcome).toMatchObject({ ok: true, alerts: ['price_below_desired'] });
    expect(d.recordNotification).toHaveBeenCalledWith(
      'item-1',
      'price_below_desired',
      '70.00',
      'USD',
    );
  });

  it('raises back_in_stock on an out→in transition, with availability as the value', async () => {
    const d = deps({ parse: () => parsed({ availability: 'in_stock' }) });
    const outcome = await processRefreshJob(job({ availability: 'out_of_stock' }), d);
    expect(outcome).toMatchObject({ ok: true, alerts: ['back_in_stock'] });
    expect(d.recordNotification).toHaveBeenCalledWith('item-1', 'back_in_stock', 'in_stock', 'USD');
  });

  it('records a failure and no observation when no price was parsed', async () => {
    const d = deps({ parse: () => parsed({ price: null }) });
    const outcome = await processRefreshJob(job(), d);
    expect(outcome).toMatchObject({ ok: false, reason: 'no_price' });
    expect(d.recordObservation).not.toHaveBeenCalled();
    expect(d.recordResult).toHaveBeenCalledWith('item-1', false);
  });

  it('records a failure when the page is unparsable', async () => {
    const d = deps({ parse: () => null });
    const outcome = await processRefreshJob(job(), d);
    expect(outcome).toMatchObject({ ok: false, reason: 'unparsable' });
    expect(d.recordResult).toHaveBeenCalledWith('item-1', false);
  });

  it('records a failure with the error reason when the fetch throws', async () => {
    const d = deps({
      fetchHtml: async () => {
        throw Object.assign(new Error('blocked'), { reason: 'blocked_address' });
      },
    });
    const outcome = await processRefreshJob(job(), d);
    expect(outcome).toMatchObject({ ok: false, reason: 'blocked_address' });
    expect(d.recordResult).toHaveBeenCalledWith('item-1', false);
  });

  it('raises no alert when nothing changed', async () => {
    const d = deps({ parse: () => parsed({ price: '90.00' }) });
    const outcome = await processRefreshJob(job({ price: '90.00' }), d);
    expect(outcome).toMatchObject({ ok: true, alerts: [] });
    expect(d.recordNotification).not.toHaveBeenCalled();
  });
});

describe('runRefreshCycle', () => {
  it('processes every due job and summarises the outcomes', async () => {
    const jobs: RefreshJob[] = [
      job(),
      { ...job(), itemId: 'item-2' },
      { ...job(), itemId: 'item-3' },
    ];
    let call = 0;
    const d = {
      ...deps({
        // item-2 fails to parse; the other two succeed.
        parse: () => (call++ === 1 ? null : parsed()),
      }),
      selectDueJobs: vi.fn(async (limit: number) => jobs.slice(0, limit)),
    };
    const summary = await runRefreshCycle(d, { limit: 10 });
    expect(summary).toMatchObject({ processed: 3, ok: 2, failed: 1 });
    expect(d.selectDueJobs).toHaveBeenCalledWith(10);
  });

  it('defaults the claim limit and returns an empty summary when nothing is due', async () => {
    const d = { ...deps(), selectDueJobs: vi.fn(async () => []) };
    const summary = await runRefreshCycle(d);
    expect(summary).toMatchObject({ processed: 0, ok: 0, failed: 0 });
    expect(d.selectDueJobs).toHaveBeenCalledWith(25);
  });
});
