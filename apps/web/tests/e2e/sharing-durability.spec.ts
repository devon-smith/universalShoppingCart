import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { mailbox } from './mailpit';
import {
  capture,
  ingest,
  signedInClient,
  signInBrowser,
  uniqueEmail,
  type SeedClient,
} from './seed';

/**
 * The destructive sharing actions must not claim more than the database recorded (M5.1).
 *
 * Revoke and Remove used to drop the row from local state and fire the Server Action with
 * `void`. The row vanished on click, so the panel read as "done" whether or not the write ever
 * reached Postgres — and a reload or navigation mid-request aborted it. For Revoke that is
 * precisely the moment a leaked invitation link is being pulled, which is why this is worth a
 * suite of its own rather than a line in `sharing.spec.ts`.
 *
 * ## Why these tests hold the request open
 *
 * Against a local stack the action settles in tens of milliseconds, so there is no observable
 * in-flight window and the old and new behaviour look identical. Both tests below therefore
 * intercept the Server Action's POST — delaying it, or failing it — which is what turns "the UI
 * did not claim success early" into something a machine can check. Measured on this branch: with
 * the request held, the pre-M5.1 build showed the member row already gone 400ms after the click,
 * and this one shows it still listed with a disabled "Removing…" button.
 *
 * The Server Action posts to the page's own URL, so `**\/app\/share**` filtered to POST is the
 * action and nothing else — the RSC payload fetches are GETs.
 */

const SHARE_ACTION = '**/app/share**';

interface Fixture {
  owner: SeedClient;
  member: SeedClient;
  cartId: string;
  itemTitle: string;
}

/** An owner with one saved item and one accepted editor. */
async function ownerWithMember(page: Page): Promise<Fixture> {
  const ownerEmail = uniqueEmail('durability', 'owner');
  const owner = await signedInClient(ownerEmail, mailbox(ownerEmail));

  const { data: cart, error } = await owner
    .from('carts')
    .select('id')
    .eq('is_default', true)
    .single();
  expect(error, error?.message).toBeNull();
  const cartId = cart!.id;

  const itemTitle = `Wexford Chore Jacket ${Date.now()}`;
  await ingest(owner, capture({ title: itemTitle, price: '128.00' }));

  const memberEmail = uniqueEmail('durability', 'member');
  const member = await signedInClient(memberEmail, mailbox(memberEmail));

  const { data: invitation, error: inviteError } = await owner.rpc('create_cart_invitation', {
    p_cart_id: cartId,
    p_role: 'editor',
    p_ttl: '7 days',
  });
  expect(inviteError, inviteError?.message).toBeNull();

  const { error: acceptError } = await member.rpc('accept_cart_invitation', {
    p_token: (invitation as unknown as { token: string }).token,
  });
  expect(acceptError, acceptError?.message).toBeNull();

  await signInBrowser(page, owner);
  return { owner, member, cartId, itemTitle };
}

/** Members of a cart, read straight from the database rather than from the page. */
async function memberCount(client: SeedClient, cartId: string): Promise<number> {
  const { data, error } = await client.from('cart_members').select('user_id').eq('cart_id', cartId);
  expect(error, error?.message).toBeNull();
  return data!.length;
}

/** Whether the invitee can still see the shared cart at all — RLS is the real check. */
async function memberSeesCart(client: SeedClient, cartId: string): Promise<boolean> {
  const { data } = await client.from('carts').select('id');
  return (data ?? []).some((cart) => cart.id === cartId);
}

function membersList(page: Page) {
  return page.getByRole('list').filter({ hasText: 'You' }).getByRole('listitem');
}

test.describe('destructive sharing actions are confirmed, not optimistic', () => {
  test('a member stays listed, under a disabled "Removing…", until the delete lands', async ({
    page,
  }) => {
    const { owner, member, cartId, itemTitle } = await ownerWithMember(page);

    // Hold the action open so the in-flight state is observable at all.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(SHARE_ACTION, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await held;
      return route.continue();
    });

    await page.goto('/app/share');
    await expect(membersList(page)).toHaveCount(2);

    const memberRow = membersList(page).filter({ hasText: 'Member' });
    await memberRow.getByRole('button', { name: 'Remove' }).click({ noWaitAfter: true });

    // The heart of M5.1: with the write still in flight, the panel has claimed nothing.
    await expect(
      memberRow,
      'the member must stay listed until the server confirms the delete',
    ).toHaveCount(1);
    const button = memberRow.getByRole('button');
    await expect(button).toHaveText('Removing…');
    await expect(button).toBeDisabled();

    // And the database agrees with the page: nothing has been removed yet.
    expect(await memberCount(owner, cartId)).toBe(2);

    release();
    await expect(membersList(page)).toHaveCount(1);
    expect(await memberCount(owner, cartId)).toBe(1);
    expect(await memberSeesCart(member, cartId)).toBe(false);
    void itemTitle;
  });

  test('a pending invitation stays listed, under a disabled "Revoking…", until it is gone', async ({
    page,
  }) => {
    const { owner, cartId } = await ownerWithMember(page);

    // A second, still-pending invitation to revoke.
    const { error } = await owner.rpc('create_cart_invitation', {
      p_cart_id: cartId,
      p_role: 'viewer',
      p_ttl: '7 days',
    });
    expect(error, error?.message).toBeNull();

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(SHARE_ACTION, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await held;
      return route.continue();
    });

    await page.goto('/app/share');
    const pending = page.getByRole('list').filter({ hasText: 'Expires' }).getByRole('listitem');
    await expect(pending).toHaveCount(1);

    await pending.getByRole('button', { name: 'Revoke' }).click({ noWaitAfter: true });

    await expect(pending, 'a revoke must not be shown as done before it is').toHaveCount(1);
    await expect(pending.getByRole('button')).toHaveText('Revoking…');
    await expect(pending.getByRole('button')).toBeDisabled();

    release();
    await expect(page.getByText('No links are waiting to be accepted.')).toBeVisible();
  });

  test('an interrupted removal is not reported as done', async ({ page }) => {
    const { owner, member, cartId } = await ownerWithMember(page);

    // The failure mode the old shape could not distinguish from success.
    await page.route(SHARE_ACTION, (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.fallback(),
    );

    await page.goto('/app/share');
    await expect(membersList(page)).toHaveCount(2);
    await membersList(page)
      .filter({ hasText: 'Member' })
      .getByRole('button', { name: 'Remove' })
      .click({ noWaitAfter: true });

    // The row is still there, because nothing was removed. Under the old optimistic shape it
    // would have disappeared and the owner would have believed the member was gone.
    await expect(membersList(page).filter({ hasText: 'Member' })).toHaveCount(1);
    expect(await memberCount(owner, cartId)).toBe(2);
    expect(await memberSeesCart(member, cartId)).toBe(true);

    // Reloading tells the same story, because the page and the database never diverged.
    await page.unroute(SHARE_ACTION);
    await page.reload();
    await expect(membersList(page)).toHaveCount(2);
  });

  /**
   * Unlike the three above, this one passes against the pre-M5.1 build too — verified by
   * reverting `SharePanel.tsx` and re-running, where the other three fail and this does not.
   * It is kept because it pins the durability claim itself: the write outlives a reload, and
   * the invitee's access really does end. What it does *not* do is discriminate the optimistic
   * shape from the confirmed one — that is what holding the request open is for.
   */
  test('a removal survives the owner reloading the moment they click', async ({ page }) => {
    const { owner, member, cartId, itemTitle } = await ownerWithMember(page);

    await page.goto('/app/share');
    await expect(membersList(page)).toHaveCount(2);

    // No route interception and no waiting: click, then reload straight into the request. The
    // POST is dispatched synchronously with the click, so it reaches Postgres and commits; a
    // reload can abandon the *response* but not the write it already caused.
    await membersList(page)
      .filter({ hasText: 'Member' })
      .getByRole('button', { name: 'Remove' })
      .click({ noWaitAfter: true });
    await page.reload();

    await expect
      .poll(() => memberCount(owner, cartId), {
        message: 'the delete should have landed despite the reload',
        timeout: 10_000,
      })
      .toBe(1);

    // The panel, re-read from the server, agrees — and so does the invitee's access.
    await page.goto('/app/share');
    await expect(membersList(page)).toHaveCount(1);
    expect(await memberSeesCart(member, cartId)).toBe(false);

    const { data: items } = await member.from('items').select('title').eq('cart_id', cartId);
    expect(
      (items ?? []).some((item) => item.title === itemTitle),
      'a removed member should not be able to read the cart items',
    ).toBe(false);
  });
});
