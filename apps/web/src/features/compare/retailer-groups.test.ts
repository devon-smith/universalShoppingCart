import { describe, expect, it } from 'vitest';

import { groupByRetailer, type GroupableItem } from './retailer-groups';

function it_(over: Partial<GroupableItem> & { id: string }): GroupableItem {
  return {
    retailer_name: 'Northwind',
    domain: 'northwind.example',
    source_url: 'https://northwind.example/p/1',
    ...over,
  };
}

describe('groupByRetailer', () => {
  it('groups items from the same domain together', () => {
    const groups = groupByRetailer([
      it_({ id: 'a', domain: 'zara.com', source_url: 'https://zara.com/a' }),
      it_({ id: 'b', domain: 'nike.com', source_url: 'https://nike.com/b' }),
      it_({ id: 'c', domain: 'zara.com', source_url: 'https://zara.com/c' }),
    ]);

    expect(groups.map((g) => g.domain)).toEqual(['zara.com', 'nike.com']);
    expect(groups[0]!.itemIds).toEqual(['a', 'c']);
    expect(groups[0]!.urls).toEqual(['https://zara.com/a', 'https://zara.com/c']);
    expect(groups[1]!.itemIds).toEqual(['b']);
  });

  it('keeps two variants of one product as two pages', () => {
    const groups = groupByRetailer([
      it_({ id: 'a', source_url: 'https://northwind.example/p?size=m' }),
      it_({ id: 'b', source_url: 'https://northwind.example/p?size=l' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.urls).toHaveLength(2);
  });

  it('groups by domain even when the display name differs', () => {
    const groups = groupByRetailer([
      it_({ id: 'a', domain: 'shop.acme.example', retailer_name: 'ACME' }),
      it_({ id: 'b', domain: 'shop.acme.example', retailer_name: 'Acme Store' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.itemIds).toEqual(['a', 'b']);
  });

  it('is case-insensitive on the domain', () => {
    const groups = groupByRetailer([
      it_({ id: 'a', domain: 'Zara.com', source_url: 'https://zara.com/a' }),
      it_({ id: 'b', domain: 'zara.com', source_url: 'https://zara.com/b' }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('drops an item whose source_url is not an http(s) address', () => {
    const groups = groupByRetailer([
      it_({ id: 'a', source_url: 'javascript:alert(1)' }),
      it_({ id: 'b', source_url: 'https://northwind.example/p/2' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.itemIds).toEqual(['b']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByRetailer([])).toEqual([]);
  });
});
