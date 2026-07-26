import { describe, expect, it } from 'vitest';

import { cn } from './cn';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('supports conditional expressions', () => {
    const active = false;
    expect(cn('btn', active && 'btn--active')).toBe('btn');
  });

  it('trims and skips whitespace-only values', () => {
    expect(cn('  a  ', '   ', 'b')).toBe('a b');
  });

  it('returns an empty string when nothing applies', () => {
    expect(cn()).toBe('');
    expect(cn(false, undefined)).toBe('');
  });
});
