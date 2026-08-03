import { describe, expect, it } from 'vitest';

import { classifyRefresh, normalizeRefreshDomain } from './classify';

describe('normalizeRefreshDomain', () => {
  it('lowercases and strips www, port, and a trailing dot', () => {
    expect(normalizeRefreshDomain('WWW.Example.com')).toBe('example.com');
    expect(normalizeRefreshDomain('example.com:443')).toBe('example.com');
    expect(normalizeRefreshDomain('example.com.')).toBe('example.com');
    expect(normalizeRefreshDomain('  shop.example.com  ')).toBe('shop.example.com');
  });
});

describe('classifyRefresh', () => {
  it('defaults an unknown domain to public_fetch — the fetch pipeline downgrades a wrong guess', () => {
    expect(classifyRefresh('shop.northwind.example')).toBe('public_fetch');
    expect(classifyRefresh('fieldcraft.example')).toBe('public_fetch');
  });

  it('marks the client-rendered brand-adapter domains browser_required', () => {
    expect(classifyRefresh('amazon.com')).toBe('browser_required');
    expect(classifyRefresh('wayfair.com')).toBe('browser_required');
    expect(classifyRefresh('stockx.com')).toBe('browser_required');
  });

  it('matches those domains through www and subdomains', () => {
    expect(classifyRefresh('www.amazon.com')).toBe('browser_required');
    expect(classifyRefresh('smile.amazon.com')).toBe('browser_required');
  });

  it('does not match a lookalike that merely contains the domain', () => {
    // `notamazon.com` and `amazon.com.evil.example` must not be treated as Amazon.
    expect(classifyRefresh('notamazon.com')).toBe('public_fetch');
    expect(classifyRefresh('amazon.com.evil.example')).toBe('public_fetch');
  });

  it('escalates to browser_required when the item was captured by a client-rendered adapter', () => {
    // Even if the domain reads as unknown, a brand-adapter capture cannot be re-fetched raw.
    expect(classifyRefresh('unknown.example', { extractorId: 'amazon' })).toBe('browser_required');
  });

  it('a platform-adapter or generic capture stays public_fetch', () => {
    expect(classifyRefresh('shop.example', { extractorId: 'shopify' })).toBe('public_fetch');
    expect(classifyRefresh('shop.example', { extractorId: null })).toBe('public_fetch');
  });

  it('classifies a blank or unusable domain as disabled — there is nothing to fetch', () => {
    expect(classifyRefresh('')).toBe('disabled');
    expect(classifyRefresh('   ')).toBe('disabled');
  });
});
