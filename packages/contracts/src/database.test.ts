import { describe, expect, it } from 'vitest';

import { canEdit } from './database';
import { Constants } from './database.types';

describe('cart roles', () => {
  it('matches the cart_role enum in the database', () => {
    expect([...Constants.public.Enums.cart_role]).toEqual(['owner', 'editor', 'viewer']);
  });

  it('lets owners and editors write, but not viewers', () => {
    expect(canEdit('owner')).toBe(true);
    expect(canEdit('editor')).toBe(true);
    expect(canEdit('viewer')).toBe(false);
  });
});
