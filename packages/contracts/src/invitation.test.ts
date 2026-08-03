import { describe, expect, it } from 'vitest';

import {
  acceptInvitationInputSchema,
  createInvitationInputSchema,
  createInvitationResultSchema,
  INVITABLE_ROLES,
  MAX_INVITE_TTL_HOURS,
} from './invitation';

const TOKEN = 'a'.repeat(64);

describe('createInvitationInputSchema', () => {
  it('accepts an editor or viewer invitation', () => {
    for (const role of INVITABLE_ROLES) {
      expect(
        createInvitationInputSchema.safeParse({ cartId: crypto.randomUUID(), role }).success,
      ).toBe(true);
    }
  });

  it('rejects an owner invitation — ownership is not grantable', () => {
    const result = createInvitationInputSchema.safeParse({
      cartId: crypto.randomUUID(),
      role: 'owner',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a ttl beyond the maximum', () => {
    const base = { cartId: crypto.randomUUID(), role: 'viewer' as const };
    expect(
      createInvitationInputSchema.safeParse({ ...base, ttlHours: MAX_INVITE_TTL_HOURS }).success,
    ).toBe(true);
    expect(
      createInvitationInputSchema.safeParse({ ...base, ttlHours: MAX_INVITE_TTL_HOURS + 1 })
        .success,
    ).toBe(false);
  });

  it('rejects a non-uuid cart id', () => {
    expect(
      createInvitationInputSchema.safeParse({ cartId: 'not-a-uuid', role: 'viewer' }).success,
    ).toBe(false);
  });

  it('treats email as optional and informational', () => {
    expect(
      createInvitationInputSchema.safeParse({ cartId: crypto.randomUUID(), role: 'viewer' })
        .success,
    ).toBe(true);
    expect(
      createInvitationInputSchema.safeParse({
        cartId: crypto.randomUUID(),
        role: 'viewer',
        email: 'not-an-email',
      }).success,
    ).toBe(false);
  });
});

describe('invite token shape', () => {
  it('accepts a 64-hex token and rejects anything else', () => {
    expect(acceptInvitationInputSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(acceptInvitationInputSchema.safeParse({ token: 'too-short' }).success).toBe(false);
    expect(acceptInvitationInputSchema.safeParse({ token: 'A'.repeat(64) }).success).toBe(false); // uppercase
  });

  it('pins the token shape on the create result too', () => {
    const ok = createInvitationResultSchema.safeParse({
      id: crypto.randomUUID(),
      token: TOKEN,
      role: 'viewer',
      expiresAt: '2026-08-10T12:00:00+00:00',
    });
    expect(ok.success).toBe(true);

    const bad = createInvitationResultSchema.safeParse({
      id: crypto.randomUUID(),
      token: 'nope',
      role: 'viewer',
      expiresAt: '2026-08-10T12:00:00+00:00',
    });
    expect(bad.success).toBe(false);
  });
});
