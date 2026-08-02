import { describe, expect, it } from 'vitest';

import {
  absoluteHttpUrl,
  domainFromUrl,
  normalizeText,
  normalizeTextCapped,
  retailerNameFromDomain,
  unique,
} from './text';

describe('normalizeText', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeText('  Wool   Runner\n Mizzle ')).toBe('Wool Runner Mizzle');
  });

  it('returns null for empty content', () => {
    expect(normalizeText('')).toBeNull();
    expect(normalizeText('   \n\t ')).toBeNull();
    expect(normalizeText(null)).toBeNull();
    expect(normalizeText(undefined)).toBeNull();
  });
});

describe('normalizeTextCapped', () => {
  it('leaves short text alone', () => {
    expect(normalizeTextCapped('A shoe.', 100)).toBe('A shoe.');
  });

  it('caps long text with an ellipsis', () => {
    const capped = normalizeTextCapped('x'.repeat(50), 10);
    expect(capped).toHaveLength(10);
    expect(capped?.endsWith('…')).toBe(true);
  });

  it('passes null through', () => {
    expect(normalizeTextCapped('  ', 10)).toBeNull();
  });
});

describe('domainFromUrl', () => {
  it('lowercases and drops www', () => {
    expect(domainFromUrl('https://WWW.Example.com/p/1')).toBe('example.com');
  });

  it('keeps other subdomains', () => {
    expect(domainFromUrl('https://shop.example.co.uk/p/1')).toBe('shop.example.co.uk');
  });

  it('rejects non-http schemes and junk', () => {
    expect(domainFromUrl('file:///etc/passwd')).toBeNull();
    expect(domainFromUrl('not a url')).toBeNull();
  });
});

describe('retailerNameFromDomain', () => {
  it('uses the registrable label', () => {
    expect(retailerNameFromDomain('example.com')).toBe('Example');
    expect(retailerNameFromDomain('shop.example.com')).toBe('Example');
  });

  it('handles multi-part public suffixes', () => {
    expect(retailerNameFromDomain('example.co.uk')).toBe('Example');
    expect(retailerNameFromDomain('shop.example.co.uk')).toBe('Example');
    expect(retailerNameFromDomain('example.com.au')).toBe('Example');
  });

  it('title-cases hyphenated names', () => {
    expect(retailerNameFromDomain('great-shoes.com')).toBe('Great Shoes');
  });

  it('degrades gracefully on a bare host', () => {
    expect(retailerNameFromDomain('localhost')).toBe('Localhost');
  });
});

describe('absoluteHttpUrl', () => {
  it('resolves a relative URL against the page', () => {
    expect(absoluteHttpUrl('/img/1.jpg', 'https://shop.example.com/p/1')).toBe(
      'https://shop.example.com/img/1.jpg',
    );
  });

  it('resolves a protocol-relative URL', () => {
    expect(absoluteHttpUrl('//cdn.example.com/1.jpg', 'https://shop.example.com/p/1')).toBe(
      'https://cdn.example.com/1.jpg',
    );
  });

  it('keeps an already-absolute URL', () => {
    expect(absoluteHttpUrl('https://cdn.example.com/1.jpg', 'https://shop.example.com')).toBe(
      'https://cdn.example.com/1.jpg',
    );
  });

  it('refuses to carry inline data into a capture', () => {
    expect(absoluteHttpUrl('data:image/png;base64,AAAA', 'https://shop.example.com')).toBeNull();
    expect(absoluteHttpUrl('javascript:alert(1)', 'https://shop.example.com')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(absoluteHttpUrl('', 'https://shop.example.com')).toBeNull();
    expect(absoluteHttpUrl(null, 'https://shop.example.com')).toBeNull();
  });
});

describe('unique', () => {
  it('preserves order', () => {
    expect(unique(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });
});
