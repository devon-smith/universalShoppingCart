import { describe, expect, it } from 'vitest';

import { normalizeUrl } from './normalize-url';

describe('normalizeUrl', () => {
  it('lowercases the host, drops www, and removes the fragment', () => {
    expect(normalizeUrl('https://WWW.Example.COM/p/123#reviews')).toBe('https://example.com/p/123');
  });

  it('removes default ports but keeps explicit non-default ones', () => {
    expect(normalizeUrl('https://example.com:443/p/1')).toBe('https://example.com/p/1');
    expect(normalizeUrl('http://example.com:8080/p/1')).toBe('http://example.com:8080/p/1');
  });

  it('collapses a trailing slash except at the root', () => {
    expect(normalizeUrl('https://example.com/p/123/')).toBe('https://example.com/p/123');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('strips tracking parameters', () => {
    expect(
      normalizeUrl(
        'https://example.com/p/1?utm_source=news&utm_medium=email&gclid=abc&fbclid=def&color=blue',
      ),
    ).toBe('https://example.com/p/1?color=blue');
  });

  it('strips affiliate breadcrumbs', () => {
    expect(normalizeUrl('https://example.com/dp/B01?ref=sr_1_3&tag=someaffil-20&th=1')).toBe(
      'https://example.com/dp/B01?th=1',
    );
  });

  it('preserves parameters that may select a variant', () => {
    expect(normalizeUrl('https://example.com/p?variant=884&size=M&psc=1')).toBe(
      'https://example.com/p?psc=1&size=M&variant=884',
    );
  });

  it('sorts query parameters so ordering cannot fork a fingerprint', () => {
    const a = normalizeUrl('https://example.com/p?b=2&a=1&c=3');
    const b = normalizeUrl('https://example.com/p?c=3&a=1&b=2');
    expect(a).toBe(b);
    expect(a).toBe('https://example.com/p?a=1&b=2&c=3');
  });

  it('sorts repeated parameters by value deterministically', () => {
    expect(normalizeUrl('https://example.com/p?f=z&f=a')).toBe('https://example.com/p?f=a&f=z');
  });

  it('drops credentials embedded in the URL', () => {
    expect(normalizeUrl('https://user:secret@example.com/p/1')).toBe('https://example.com/p/1');
  });

  it('honours caller-supplied drop and keep lists', () => {
    expect(normalizeUrl('https://example.com/p?sid=9&color=red', { dropParameters: ['sid'] })).toBe(
      'https://example.com/p?color=red',
    );
    expect(normalizeUrl('https://example.com/p?ref=abc', { keepParameters: ['ref'] })).toBe(
      'https://example.com/p?ref=abc',
    );
  });

  it('rejects non-http(s) and unparseable input', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeUrl('chrome-extension://abc/sidepanel.html')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });

  it('is idempotent', () => {
    const once = normalizeUrl('https://WWW.Example.com/p/1/?utm_source=x&b=2&a=1#frag');
    expect(once).not.toBeNull();
    expect(normalizeUrl(once as string)).toBe(once);
  });
});
