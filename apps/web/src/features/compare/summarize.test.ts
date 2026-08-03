import { describe, expect, it, vi } from 'vitest';

import type { CompareInput, CompareItem } from './compare';
import { compareItems } from './compare';
import type { SummaryModelCall, SummaryModelResult } from './summarize';
import {
  AiSummaryInvalidError,
  AiSummaryRefusedError,
  generateComparisonSummary,
  SUMMARY_MODEL,
  SUMMARY_PROMPT_VERSION,
} from './summarize';

function item(overrides: Partial<CompareItem>): CompareItem {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    cart_id: 'cart-1',
    title: 'A jacket',
    brand: null,
    description: null,
    retailer_name: 'Shop',
    domain: 'shop.example',
    source_url: 'https://shop.example/p/1',
    canonical_url: 'https://shop.example/p/1',
    image_url: null,
    currency: 'USD',
    current_price: null,
    original_price: null,
    availability: 'in_stock',
    product_availability: null,
    selected_variant: {},
    identifiers: {},
    note: null,
    quantity: 1,
    priority: 'normal',
    desired_price: null,
    status: 'saved',
    last_observed_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    composition: null,
    ...overrides,
  } as CompareItem;
}

function twoItemComparison() {
  const inputs: CompareInput[] = [
    { item: item({ id: 'a', title: 'Blue parka', current_price: '120.00' }), summary: null },
    { item: item({ id: 'b', title: 'Red parka', current_price: '99.00' }), summary: null },
  ];
  return compareItems(inputs);
}

/** A model call that always returns the given result, and records the messages it saw. */
function stubCall(result: SummaryModelResult): SummaryModelCall & { calls: unknown[] } {
  const calls: unknown[] = [];
  const fn = vi.fn(async (messages) => {
    calls.push(messages);
    return result;
  }) as unknown as SummaryModelCall & { calls: unknown[] };
  fn.calls = calls;
  return fn;
}

describe('generateComparisonSummary', () => {
  it('returns a validated summary with model and prompt-version provenance', async () => {
    const call = stubCall({
      refused: false,
      model: 'claude-opus-5-xyz',
      content: {
        overview: 'Two parkas; Item 2 is cheaper.',
        points: [{ text: 'Item 2 costs less.', itemRefs: ['Item 2'] }],
        missingData: [],
      },
    });

    const result = await generateComparisonSummary(twoItemComparison(), call);

    expect(result.summary.overview).toMatch(/cheaper/);
    expect(result.model).toBe('claude-opus-5-xyz');
    expect(result.promptVersion).toBe(SUMMARY_PROMPT_VERSION);
    expect(result.facts.items).toHaveLength(2);
  });

  it('passes the grounded facts to the model as system + user messages', async () => {
    const call = stubCall({
      refused: false,
      model: SUMMARY_MODEL,
      content: { overview: 'ok', points: [], missingData: [] },
    });

    await generateComparisonSummary(twoItemComparison(), call);

    const [messages] = call.calls as [{ system: string; user: string }];
    expect(messages.system).toMatch(/only the provided facts/i);
    expect(messages.user).toContain('Item 1: Blue parka');
  });

  it('throws AiSummaryRefusedError on a refusal, without reading content', async () => {
    const call = stubCall({ refused: true, model: SUMMARY_MODEL, content: undefined });
    await expect(generateComparisonSummary(twoItemComparison(), call)).rejects.toBeInstanceOf(
      AiSummaryRefusedError,
    );
  });

  it('rejects a summary that does not match the schema', async () => {
    const call = stubCall({
      refused: false,
      model: SUMMARY_MODEL,
      content: { overview: '', points: [], missingData: [] }, // empty overview is invalid
    });
    await expect(generateComparisonSummary(twoItemComparison(), call)).rejects.toBeInstanceOf(
      AiSummaryInvalidError,
    );
  });

  it('rejects null content (schema parse failed upstream)', async () => {
    const call = stubCall({ refused: false, model: SUMMARY_MODEL, content: null });
    await expect(generateComparisonSummary(twoItemComparison(), call)).rejects.toBeInstanceOf(
      AiSummaryInvalidError,
    );
  });

  it('rejects a summary that references an item that does not exist (fabrication)', async () => {
    const call = stubCall({
      refused: false,
      model: SUMMARY_MODEL,
      content: {
        overview: 'Comparing three parkas.',
        points: [{ text: 'Item 3 is best.', itemRefs: ['Item 3'] }], // only 2 items exist
        missingData: [],
      },
    });
    await expect(generateComparisonSummary(twoItemComparison(), call)).rejects.toThrow(
      /unknown item "Item 3"/,
    );
  });

  it('accepts a summary whose points carry no item refs', async () => {
    const call = stubCall({
      refused: false,
      model: SUMMARY_MODEL,
      content: {
        overview: 'Both are in stock.',
        points: [{ text: 'Both items are available.' }],
        missingData: ['Item 1 has no listed composition.'],
      },
    });
    const result = await generateComparisonSummary(twoItemComparison(), call);
    expect(result.summary.points[0]!.itemRefs).toEqual([]);
    expect(result.summary.missingData).toHaveLength(1);
  });
});
