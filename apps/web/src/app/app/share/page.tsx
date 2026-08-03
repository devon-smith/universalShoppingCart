import type { InvitableRole } from '@universal-cart/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  SharePanel,
  type MemberEntry,
  type OwnedCart,
  type PendingInvite,
} from '@/features/sharing/SharePanel';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Share a cart · Universal Cart',
};

/** Per-user, and it lists live invitations — nothing here is prerenderable. */
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Share a cart.
 *
 * Only carts the user owns can be shared, so the query filters on `owner_id` rather than
 * trusting `carts_select_readable`, which also returns carts they were invited to. The selected
 * cart comes from `?cart=`, falling back to the default; its pending (unaccepted, unexpired)
 * invitations and current members are loaded here and handed to the client panel. RLS is the
 * real gate on every one of these reads — a cart id in the URL that the user does not own
 * returns nothing rather than someone else's invitations.
 */
export default async function SharePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=%2Fapp%2Fshare');
  }

  const { data: cartRows } = await supabase
    .from('carts')
    .select('id, name, is_default, owner_id')
    .eq('owner_id', user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  const owned: OwnedCart[] = (cartRows ?? []).map(({ id, name, is_default }) => ({
    id,
    name,
    is_default,
  }));

  const requested = first((await searchParams).cart);
  const selected =
    owned.find((cart) => cart.id === requested) ??
    owned.find((cart) => cart.is_default) ??
    owned[0];

  const shell = (children: ReactNode) => (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <Link
          href="/app"
          className="uc-focusable w-fit text-sm text-[var(--uc-foreground-muted)] hover:underline"
        >
          &larr; Your carts
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Share a cart</h1>
        {selected ? (
          <p className="text-sm text-[var(--uc-foreground-muted)]">
            Invite people to <strong>{selected.name}</strong>. They see and compare its items;
            editors can also change them.
          </p>
        ) : null}
      </header>
      {children}
    </main>
  );

  if (!selected) {
    return shell(<p className="uc-callout">You do not own any carts to share yet.</p>);
  }

  const nowIso = new Date().toISOString();

  const [{ data: inviteRows }, { data: memberRows }] = await Promise.all([
    supabase
      .from('cart_invitations')
      .select('id, role, email, expires_at')
      .eq('cart_id', selected.id)
      .is('accepted_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false }),
    supabase.from('cart_members').select('user_id, role').eq('cart_id', selected.id),
  ]);

  const pending: PendingInvite[] = (inviteRows ?? []).map((row) => ({
    id: row.id,
    // The table's role is a cart_role, but a CHECK constraint forbids `owner` on an invitation.
    role: row.role as InvitableRole,
    email: row.email,
    expiresAt: row.expires_at,
  }));

  const members: MemberEntry[] = (memberRows ?? []).map((row) => ({
    userId: row.user_id,
    role: row.role,
  }));

  return shell(
    <SharePanel
      cartId={selected.id}
      carts={owned}
      currentUserId={user.id}
      initialPending={pending}
      members={members}
      nowIso={nowIso}
    />,
  );
}
