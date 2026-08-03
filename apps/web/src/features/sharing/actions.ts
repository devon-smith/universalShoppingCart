'use server';

import {
  acceptInvitationResultSchema,
  createInvitationInputSchema,
  createInvitationResultSchema,
  inviteTokenSchema,
  type AcceptInvitationResult,
  type CreateInvitationInput,
  type CreateInvitationResult,
} from '@universal-cart/contracts';
import { z } from 'zod';

import { publicEnv } from '@/lib/env';
import { createServerSupabase } from '@/lib/supabase/server';

import {
  acceptFailureMessage,
  acceptFailureReason,
  inviteUrl,
  ttlToInterval,
  type AcceptFailure,
} from './sharing';

/**
 * Server Actions for shared-cart invitations (BUILD_PLAN.md §8.3, §12).
 *
 * Creating and accepting both go through the SECURITY DEFINER RPCs, which own the rules the
 * client is not allowed to enforce: only an owner may invite, the raw token is returned exactly
 * once and never stored, and acceptance is single-use and expiry-checked. Revoking is an
 * ordinary `DELETE`, gated by `cart_invitations_delete_owner` RLS — the client cannot forge
 * access, so these actions do not re-check ownership defensively.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export type CreateInvitationActionResult =
  { ok: true; invitation: CreateInvitationResult; url: string } | { ok: false; error: string };

export type AcceptInvitationActionResult =
  | { ok: true; result: AcceptInvitationResult }
  | { ok: false; reason: AcceptFailure; error: string };

async function currentUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * Mint an invitation for a cart the caller owns and return its one-time link.
 *
 * The raw token lives in the result and nowhere else — it is not persisted and cannot be
 * fetched again, so the panel must show it now or lose it.
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationActionResult> {
  const parsed = createInvitationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That invitation is not valid.' };
  }

  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'You need to be signed in to invite someone.' };

  const { data, error } = await supabase.rpc('create_cart_invitation', {
    p_cart_id: parsed.data.cartId,
    p_role: parsed.data.role,
    p_email: parsed.data.email ?? undefined,
    p_ttl: ttlToInterval(parsed.data.ttlHours),
  });

  if (error) return { ok: false, error: error.message };

  const result = createInvitationResultSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: 'The server returned an unexpected invitation. Please try again.' };
  }

  return {
    ok: true,
    invitation: result.data,
    url: inviteUrl(publicEnv.NEXT_PUBLIC_APP_URL, result.data.token),
  };
}

/**
 * Redeem a bearer token for the signed-in user.
 *
 * The token shape is validated at the edge so a malformed link never reaches the database; the
 * RPC's own SQLSTATEs cover the states only it can know — not found, expired, already used.
 */
export async function acceptInvitation(token: string): Promise<AcceptInvitationActionResult> {
  const parsed = inviteTokenSchema.safeParse(token);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', error: acceptFailureMessage('invalid') };
  }

  const { supabase, user } = await currentUser();
  if (!user) {
    return { ok: false, reason: 'unauthenticated', error: acceptFailureMessage('unauthenticated') };
  }

  const { data, error } = await supabase.rpc('accept_cart_invitation', { p_token: parsed.data });
  if (error) {
    const reason = acceptFailureReason(error);
    return { ok: false, reason, error: acceptFailureMessage(reason) };
  }

  const result = acceptInvitationResultSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, reason: 'unknown', error: acceptFailureMessage('unknown') };
  }

  return { ok: true, result: result.data };
}

/**
 * Revoke a pending invitation, killing its link.
 *
 * A plain delete: RLS lets only the cart owner remove a row, and a non-existent or
 * already-accepted id simply affects nothing, so a leaked link can always be pulled.
 */
export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(invitationId);
  if (!parsed.success) return { ok: false, error: 'Unknown invitation.' };

  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase.from('cart_invitations').delete().eq('id', parsed.data);
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
