import { z } from 'zod';

import type { CartRole } from './database';

/**
 * Shared-cart invitation payloads (BUILD_PLAN.md §7.6, §8.3).
 *
 * These validate the boundary around the `create_cart_invitation` and `accept_cart_invitation`
 * RPCs. Two rules are encoded here rather than merely documented:
 *
 * - **You cannot invite as an owner.** Ownership is `carts.owner_id` and immutable; an
 *   invitation only ever grants `editor` or `viewer`. The schema makes `owner` unrepresentable
 *   as an invited role, matching the `cart_invitations_role_not_owner` database constraint.
 * - **The token is an opaque 64-hex bearer string.** It is returned once by create and never
 *   stored; both the create result and the accept input pin its exact shape so a malformed
 *   value fails at the edge instead of at the database.
 */

/** Roles an invitation may grant — never `owner`. A subset of {@link CartRole}. */
export const INVITABLE_ROLES = ['editor', 'viewer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];
export const invitableRoleSchema = z.enum(INVITABLE_ROLES);

/** The raw bearer token: SHA-256's worth of hex, lowercase. */
export const INVITE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const inviteTokenSchema = z.string().regex(INVITE_TOKEN_PATTERN, 'Malformed invite token');

/** The longest an invitation may live, so a `ttlHours` cannot be set to something absurd. */
export const MAX_INVITE_TTL_HOURS = 24 * 30;

export const createInvitationInputSchema = z.object({
  cartId: z.string().uuid(),
  role: invitableRoleSchema,
  /** Informational only — acceptance is by token, not email. */
  email: z.string().email().nullish(),
  ttlHours: z.number().int().positive().max(MAX_INVITE_TTL_HOURS).optional(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;

/** What `create_cart_invitation` returns — the raw token appears here and nowhere else. */
export const createInvitationResultSchema = z.object({
  id: z.string().uuid(),
  token: inviteTokenSchema,
  role: invitableRoleSchema,
  // ISO 8601 from the RPC; kept permissive because Postgres emits an offset, not always `Z`.
  expiresAt: z.string(),
});
export type CreateInvitationResult = z.infer<typeof createInvitationResultSchema>;

export const acceptInvitationInputSchema = z.object({
  token: inviteTokenSchema,
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;

export const acceptInvitationResultSchema = z.object({
  cartId: z.string().uuid(),
  role: invitableRoleSchema,
});
export type AcceptInvitationResult = z.infer<typeof acceptInvitationResultSchema>;

/** A compile-time check that every invitable role is a real cart role. */
const _invitableIsCartRole: readonly CartRole[] = INVITABLE_ROLES;
void _invitableIsCartRole;
