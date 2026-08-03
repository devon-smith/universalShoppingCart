import { INVITE_TOKEN_PATTERN } from '@universal-cart/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AcceptInvitation } from '@/features/sharing/AcceptInvitation';
import { getCurrentUser } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Accept invitation · Universal Cart',
};

/** Membership changes on accept, and the sign-in gate reads the session — nothing to prerender. */
export const dynamic = 'force-dynamic';

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link href="/" className="uc-wordmark w-fit text-xl tracking-tight">
          Universal Cart
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">You&rsquo;ve been invited</h1>
      </header>
      {children}
    </main>
  );
}

/**
 * The shared-cart accept route.
 *
 * The token is checked for shape here so a mistyped link gets a plain message instead of a
 * database round trip, and the route is public — an invitee is usually signed out — so a missing
 * session redirects to sign-in carrying this exact path as `next`, and the accept button is
 * reached again afterwards. What the token points at is deliberately not revealed before
 * acceptance: the page speaks only in generalities about "a shared cart".
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!INVITE_TOKEN_PATTERN.test(token)) {
    return (
      <InviteShell>
        <p role="alert" className="uc-callout uc-callout--danger">
          This invitation link is malformed. Ask the cart owner for a new one.
        </p>
        <Link href="/app" className="uc-button uc-button--ghost uc-button--full uc-focusable">
          Go to your carts
        </Link>
      </InviteShell>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return (
    <InviteShell>
      <AcceptInvitation token={token} />
    </InviteShell>
  );
}
