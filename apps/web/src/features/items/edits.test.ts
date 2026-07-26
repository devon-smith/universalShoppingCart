import { describe, expect, it } from 'vitest';

import { itemEditSchema, parseItemEditForm, toColumns } from './edits';

function form(values: Record<string, string>): { get(name: string): string | null } {
  return { get: (name: string) => values[name] ?? null };
}

describe('itemEditSchema', () => {
  it('accepts a complete edit', () => {
    const result = itemEditSchema.parse({
      note: 'for the trip',
      quantity: 2,
      priority: 'high',
      desiredPrice: '79.99',
      status: 'cart',
    });

    expect(result).toEqual({
      note: 'for the trip',
      quantity: 2,
      priority: 'high',
      desiredPrice: '79.99',
      status: 'cart',
    });
  });

  it('turns a blank note into null rather than an empty string', () => {
    expect(
      itemEditSchema.parse({
        note: '   ',
        quantity: 1,
        priority: 'normal',
        desiredPrice: null,
        status: 'saved',
      }).note,
    ).toBeNull();
  });

  it('rejects a quantity below one', () => {
    expect(
      itemEditSchema.safeParse({
        note: null,
        quantity: 0,
        priority: 'normal',
        desiredPrice: null,
        status: 'saved',
      }).success,
    ).toBe(false);
  });

  it('rejects a fractional quantity', () => {
    expect(
      itemEditSchema.safeParse({
        note: null,
        quantity: 1.5,
        priority: 'normal',
        desiredPrice: null,
        status: 'saved',
      }).success,
    ).toBe(false);
  });

  it('rejects a desired price that is not a decimal amount', () => {
    for (const desiredPrice of ['$79.99', '79,99', 'cheap', '79.9999999']) {
      expect(
        itemEditSchema.safeParse({
          note: null,
          quantity: 1,
          priority: 'normal',
          desiredPrice,
          status: 'saved',
        }).success,
        desiredPrice,
      ).toBe(false);
    }
  });

  it('rejects an unknown status or priority', () => {
    expect(
      itemEditSchema.safeParse({
        note: null,
        quantity: 1,
        priority: 'urgent',
        desiredPrice: null,
        status: 'saved',
      }).success,
    ).toBe(false);
    expect(
      itemEditSchema.safeParse({
        note: null,
        quantity: 1,
        priority: 'normal',
        desiredPrice: null,
        status: 'wishlist',
      }).success,
    ).toBe(false);
  });

  it('rejects an over-long note', () => {
    expect(
      itemEditSchema.safeParse({
        note: 'x'.repeat(2001),
        quantity: 1,
        priority: 'normal',
        desiredPrice: null,
        status: 'saved',
      }).success,
    ).toBe(false);
  });
});

describe('parseItemEditForm', () => {
  it('parses a well-formed submission', () => {
    const parsed = parseItemEditForm(
      form({
        note: 'for the trip',
        quantity: '3',
        priority: 'high',
        desiredPrice: '75.00',
        status: 'cart',
      }),
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.edit).toEqual({
      note: 'for the trip',
      quantity: 3,
      priority: 'high',
      desiredPrice: '75.00',
      status: 'cart',
    });
  });

  it('treats an empty desired price as no target, not as zero', () => {
    // Zero would make every item permanently "below its target".
    const parsed = parseItemEditForm(form({ quantity: '1', priority: 'normal', status: 'saved' }));
    expect(parsed.edit?.desiredPrice).toBeNull();
  });

  it('reports a field-level message the form can show', () => {
    const parsed = parseItemEditForm(
      form({ quantity: '0', priority: 'normal', status: 'saved', desiredPrice: 'free' }),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.errors?.quantity).toMatch(/at least 1/);
    expect(parsed.errors?.desiredPrice).toMatch(/79\.99/);
  });

  it('rejects a non-numeric quantity instead of storing NaN', () => {
    expect(
      parseItemEditForm(form({ quantity: 'lots', priority: 'normal', status: 'saved' })).ok,
    ).toBe(false);
  });
});

describe('toColumns', () => {
  it('maps to the database column names', () => {
    expect(
      toColumns({
        note: 'hi',
        quantity: 2,
        priority: 'low',
        desiredPrice: '10.00',
        status: 'purchased',
      }),
    ).toEqual({
      note: 'hi',
      quantity: 2,
      priority: 'low',
      desired_price: '10.00',
      status: 'purchased',
    });
  });

  it('carries a null desired price through', () => {
    expect(
      toColumns({
        note: null,
        quantity: 1,
        priority: 'normal',
        desiredPrice: null,
        status: 'saved',
      }).desired_price,
    ).toBeNull();
  });
});
