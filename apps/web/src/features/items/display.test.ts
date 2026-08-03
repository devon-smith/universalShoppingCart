import { describe, expect, it } from 'vitest';

import { displayTitle, sourceLine } from './display';

describe('displayTitle', () => {
  it('drops the shop name a page title appends', () => {
    expect(displayTitle('Alcott 3-Seater Sofa | Wayfair', 'Wayfair')).toBe('Alcott 3-Seater Sofa');
  });

  it('drops the review furniture the audit found', () => {
    expect(displayTitle('Alcott 3-Seater Sofa & Reviews | Wayfair', 'Wayfair')).toBe(
      'Alcott 3-Seater Sofa',
    );
  });

  it('recognises the shop from the domain when the retailer name differs', () => {
    expect(displayTitle('Meridian Wool Runner | Northwind', null, 'shop.northwind.example')).toBe(
      'Meridian Wool Runner',
    );
  });

  it('drops several tail segments at once', () => {
    expect(displayTitle('Kestrel Rain Shell - Free Shipping - Fieldcraft', 'Fieldcraft')).toBe(
      'Kestrel Rain Shell',
    );
  });

  it('leaves a clean title exactly as it is', () => {
    expect(displayTitle('Meridian Wool Runner', 'Northwind')).toBe('Meridian Wool Runner');
  });

  it('never drops the first segment, even when it names the shop', () => {
    // A title that is only the shop name is useless, but inventing a better one is worse.
    expect(displayTitle('Wayfair', 'Wayfair')).toBe('Wayfair');
  });

  it('keeps a hyphenated product name that is not a separator', () => {
    expect(displayTitle('T-Shirt', 'Northwind')).toBe('T-Shirt');
  });

  it('keeps an interior segment that merely resembles noise', () => {
    // "Reviews" here is part of the name, not a tail — only trailing segments are considered.
    expect(displayTitle('Reviews Camera Bag | Northwind', 'Northwind')).toBe('Reviews Camera Bag');
  });

  it('does not trim a brand that happens to contain a noise word', () => {
    expect(displayTitle('Free People Midi Dress', 'Nordstrom')).toBe('Free People Midi Dress');
  });

  it('matches the shop name loosely across punctuation and case', () => {
    expect(displayTitle("Wool Runner | Levi's", 'levis')).toBe('Wool Runner');
  });

  it('drops a locale tail', () => {
    expect(displayTitle('Wool Runner | Northwind | US', 'Northwind')).toBe('Wool Runner');
  });

  it('leaves an empty or whitespace title alone rather than returning nothing', () => {
    expect(displayTitle('   ')).toBe('   ');
  });

  it('survives a title that is entirely noise', () => {
    expect(displayTitle('Reviews | Wayfair', 'Wayfair')).toBe('Reviews');
  });

  it('works with no retailer or domain given', () => {
    expect(displayTitle('Wool Runner & Reviews')).toBe('Wool Runner');
  });
});

describe('sourceLine', () => {
  it('says it once when brand and retailer are the same fact', () => {
    // The audit finding: cards read "Northwind · Northwind".
    expect(sourceLine('Northwind', 'Northwind')).toEqual({
      parts: ['Northwind'],
      text: 'Northwind',
    });
  });

  it('treats a differently-punctuated brand as the same fact', () => {
    expect(sourceLine('north-wind', 'Northwind').parts).toEqual(['Northwind']);
  });

  it('shows both when they are genuinely different', () => {
    expect(sourceLine('Patagonia', 'Backcountry')).toEqual({
      parts: ['Patagonia', 'Backcountry'],
      text: 'Patagonia · Backcountry',
    });
  });

  it('falls back to the retailer when there is no brand', () => {
    expect(sourceLine(null, 'Northwind').parts).toEqual(['Northwind']);
    expect(sourceLine('   ', 'Northwind').parts).toEqual(['Northwind']);
  });
});
