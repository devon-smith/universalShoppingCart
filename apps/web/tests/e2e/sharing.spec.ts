import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { mailbox, signInUrlFrom } from './mailpit';
import {
  capture,
  ingest,
  signedInClient,
  signInBrowser,
  uniqueEmail,
  type SeedClient,
} from './seed';

/**
 * Sharing: the invite → accept → remove loop, end to end, across two real accounts.
 *
 * The point of this suite is the handover between two people, which no unit test can stand in
 * for: an owner mints a link in their browser, a *different* browser context with a *different*
 * session opens it, and the cart crosses the boundary. `sharing.test.ts` already covers the pure
 * logic and `09_cart_invitation_rpcs_test.sql` covers the RPC's own guarantees; what is left —
 * and what breaks in practice — is the wiring between them.
 *
 * Two accounts means two browser contexts. Sharing a context would let the owner's cookies
 * satisfy the invitee's session and the test would pass while proving nothing.
 */

/** The invitee's context: its own cookie jar, so B is genuinely signed out to begin with. */
async function freshContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** The owner's default cart id, which is also the cart the invitation is for. */
async function defaultCartId(client: SeedClient): Promise<string> {
  const { data, error } = await client.from('carts').select('id').eq('is_default', true).single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

/**
 * Mint a link straight from the RPC.
 *
 * Used only by the tests whose subject is what happens to a link *after* it exists — revoked,
 * expired. The main test below creates its link through the panel, which is what actually
 * exercises the owner's UI.
 */
async function mintToken(
  client: SeedClient,
  cartId: string,
  ttl: string,
): Promise<{ id: string; token: string; expiresAt: string }> {
  const { data, error } = await client.rpc('create_cart_invitation', {
    p_cart_id: cartId,
    p_role: 'editor',
    p_ttl: ttl,
  });
  expect(error, error?.message).toBeNull();
  const result = data as unknown as { id: string; token: string; expiresAt: string };
  expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  return result;
}

/** Sign B in through the login page they were redirected to, and follow the email back. */
async function signInAtLoginPage(page: Page, email: string): Promise<void> {
  const inbox = mailbox(email);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.locator('p[role="status"]')).toContainText(email);
  await page.goto(signInUrlFrom(await inbox.next()));
}

test.describe('shared carts', () => {
  test('an owner invites an editor, who accepts once, sees the items, and can be removed', async ({
    page,
    browser,
  }) => {
    const ownerEmail = uniqueEmail('share', 'owner');
    const owner = await signedInClient(ownerEmail, mailbox(ownerEmail));
    const cartId = await defaultCartId(owner);

    // A distinctive title, so seeing it in B's browser cannot be a coincidence of seeding.
    const sharedTitle = `Alder Field Coat ${Date.now()}`;
    await ingest(owner, capture({ title: sharedTitle, price: '164.00' }));

    await signInBrowser(page, owner);

    // ---- A mints the link through the panel ----
    await page.getByTestId('account-menu').click();
    await page.getByRole('link', { name: /Share a cart/ }).click();
    await expect(page).toHaveURL(/\/app\/share/);

    // Editor is the default, but assert it rather than assume: the role is the whole point of
    // the invitation and a changed default would silently make this a viewer test.
    //
    // The exact accessible name is the assertion. M5 moved the role description out of the
    // <label> onto `aria-describedby` and made the role word real capitalised text, so the name
    // a screen reader reads is now exactly the word on screen. Matching it exactly is what keeps
    // that true — a loose or case-insensitive match would pass again if the description leaked
    // back into the name.
    await expect(page.getByRole('radio', { name: 'Editor' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Viewer' })).not.toBeChecked();

    await expect(page.getByText('No links are waiting to be accepted.')).toBeVisible();
    await page.getByRole('button', { name: 'Create invitation link' }).click();

    const linkField = page.getByLabel('Invitation link');
    await expect(linkField).toBeVisible();
    const inviteUrl = await linkField.inputValue();
    const token = inviteUrl.split('/invite/')[1]!;
    expect(token, 'the panel should surface a 64-hex token').toMatch(/^[0-9a-f]{64}$/);

    // Shown once, and said so.
    await expect(page.getByText(/shown once and cannot be retrieved again/)).toBeVisible();

    // It now appears as pending, and nobody has accepted it yet.
    const pending = page.getByRole('list').filter({ hasText: 'Expires' }).getByRole('listitem');
    await expect(pending).toHaveCount(1);
    await expect(pending.first()).toContainText('Editor');

    // Access is still the owner alone — a count, because the owner's own row always exists.
    const members = page.getByRole('list').filter({ hasText: 'You' }).getByRole('listitem');
    await expect(members).toHaveCount(1);
    await expect(members.first()).toContainText('Owner');

    // ---- B, signed out, opens the link ----
    const invitee = await freshContext(browser);
    const inviteeEmail = uniqueEmail('share', 'invitee');

    await invitee.goto(`/invite/${token}`);
    await expect(
      invitee,
      'a signed-out invitee should be sent to sign in, carrying the invite path',
    ).toHaveURL(`/login?next=%2Finvite%2F${token}`);

    await signInAtLoginPage(invitee, inviteeEmail);

    // Signing in returns them to the invitation, not to the dashboard.
    await expect(invitee).toHaveURL(`/invite/${token}`);
    await expect(invitee.getByRole('heading', { name: /You.{0,3}ve been invited/ })).toBeVisible();

    // Nothing about the cart is revealed before consent, and nothing has been granted yet.
    await expect(invitee.getByRole('button', { name: 'Accept invitation' })).toBeVisible();

    await invitee.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(invitee.locator('p[role="status"]')).toContainText('editor');
    await expect(invitee.locator('p[role="status"]')).toContainText('access to this shared cart');

    await invitee.getByRole('link', { name: 'Open the cart' }).click();
    await expect(invitee).toHaveURL(/\/app$/);

    // ---- B can now see A's items ----
    const cartSelect = invitee.getByLabel('Cart', { exact: true }).first();
    await expect(
      cartSelect.locator('option'),
      'the invitee should now have their own cart and the shared one',
    ).toHaveCount(2);

    await cartSelect.selectOption(cartId);
    await expect(invitee.getByTestId('item-card').filter({ hasText: sharedTitle })).toBeVisible();

    // ---- the same link cannot be used twice ----
    await invitee.goto(`/invite/${token}`);
    await invitee.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(invitee.locator('p[role="alert"]')).toContainText(
      'This invitation has already been used.',
    );

    // ---- and the owner sees them as a member, with the invitation no longer pending ----
    await page.reload();
    await expect(
      page.getByText('No links are waiting to be accepted.'),
      'an accepted invitation should stop being pending',
    ).toBeVisible();

    const membersAfter = page.getByRole('list').filter({ hasText: 'You' }).getByRole('listitem');
    await expect(membersAfter).toHaveCount(2);
    await expect(membersAfter.filter({ hasText: 'You' })).toContainText('Owner');
    // The invitee shows as a short id, not a name: `profiles` is not readable across accounts.
    await expect(membersAfter.filter({ hasText: 'Member' })).toContainText('Editor');

    // ---- the owner removes them again, and access goes with it ----
    // The owner has no Remove button of their own: ownership is `carts.owner_id` and immutable,
    // so removing that row would strip the listing without ceding the cart.
    await expect(
      membersAfter.filter({ hasText: 'You' }).getByRole('button', { name: 'Remove' }),
      'the owner should not be able to remove themselves',
    ).toHaveCount(0);

    // The Server Action is fired and not awaited — `remove()` drops the row from local state
    // optimistically and `void`s the call, exactly as `revoke()` does. So the count below would
    // go to 1 whether or not the delete ever reached Postgres, and reloading straight afterwards
    // races the request: the first version of this test reloaded immediately, aborted the
    // in-flight POST, and reported a member who had genuinely not been removed.
    //
    // Waiting on the response makes the reload assertion mean what it claims. A fixed sleep
    // would also pass and would be a worse test — it would go green on a slow machine that had
    // silently dropped the write.
    const removed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/app/share') &&
        response.status() < 400,
    );
    await membersAfter
      .filter({ hasText: 'Member' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(membersAfter).toHaveCount(1);
    await expect(membersAfter.first()).toContainText('You');
    await removed;

    // Survives a reload, so the row is really gone rather than only dropped from local state.
    await page.reload();
    await expect(
      page.getByRole('list').filter({ hasText: 'You' }).getByRole('listitem'),
    ).toHaveCount(1);

    // And B loses the cart: back to their own, with A's items no longer reachable.
    await invitee.goto('/app');
    await expect(
      invitee.getByLabel('Cart', { exact: true }).first().locator('option'),
      'a removed member should be left with only their own cart',
    ).toHaveCount(1);
    await expect(invitee.getByTestId('item-card').filter({ hasText: sharedTitle })).toHaveCount(0);

    await invitee.context().close();
  });

  test('a revoked link cannot be accepted', async ({ page, browser }) => {
    const ownerEmail = uniqueEmail('share', 'revoker');
    const owner = await signedInClient(ownerEmail, mailbox(ownerEmail));
    const cartId = await defaultCartId(owner);
    const { token } = await mintToken(owner, cartId, '7 days');

    await signInBrowser(page, owner);
    await page.goto('/app/share');

    // Revoke it through the panel — the owner's real affordance for a leaked link.
    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('No links are waiting to be accepted.')).toBeVisible();

    const invitee = await freshContext(browser);
    const inviteeEmail = uniqueEmail('share', 'revoked');
    const inviteeClient = await signedInClient(inviteeEmail, mailbox(inviteeEmail));
    await signInBrowser(invitee, inviteeClient);

    await invitee.goto(`/invite/${token}`);
    await invitee.getByRole('button', { name: 'Accept invitation' }).click();

    // A revoked invitation is deleted, so it reads as "not valid" rather than "already used" —
    // the row is gone, and the message must not imply somebody else took it.
    await expect(invitee.locator('p[role="alert"]')).toContainText(
      'This invitation link is not valid.',
    );

    // And no access was granted: the invitee still has only their own cart.
    await invitee.goto('/app');
    await expect(invitee.getByLabel('Cart', { exact: true }).first().locator('option')).toHaveCount(
      1,
    );

    await invitee.context().close();
  });

  test('an expired link cannot be accepted', async ({ browser }) => {
    const ownerEmail = uniqueEmail('share', 'expirer');
    const owner = await signedInClient(ownerEmail, mailbox(ownerEmail));
    const cartId = await defaultCartId(owner);

    // The RPC only requires a positive interval, so a real expiry can be produced in a second
    // rather than simulated. The panel offers a one-day minimum, which is why this one link is
    // minted through the RPC: the state under test is not reachable from the UI in a test's
    // lifetime, and faking it by writing `expires_at` would test a row rather than the rule.
    const { token, expiresAt } = await mintToken(owner, cartId, '1 second');

    const invitee = await freshContext(browser);
    const inviteeEmail = uniqueEmail('share', 'expired');
    const inviteeClient = await signedInClient(inviteeEmail, mailbox(inviteeEmail));
    await signInBrowser(invitee, inviteeClient);

    // Wait the invitation out rather than probing it. `expires_at <= now()` is evaluated in
    // Postgres, so the deadline is read from the RPC's own `expiresAt` — polling by *attempting*
    // to accept would consume the single-use token on the first try and every later attempt
    // would report "already accepted", which is a different rule and would pass for the wrong
    // reason. That is what the first draft of this test did.
    const remaining = new Date(expiresAt).getTime() - Date.now();
    await invitee.waitForTimeout(Math.max(0, remaining) + 1_500);

    await invitee.goto(`/invite/${token}`);
    await invitee.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(invitee.locator('p[role="alert"]')).toContainText('This invitation has expired.');

    await invitee.context().close();
  });

  test('a malformed link is refused without a database round trip', async ({ page }) => {
    const email = uniqueEmail('share', 'malformed');
    const client = await signedInClient(email, mailbox(email));
    await signInBrowser(page, client);

    await page.goto('/invite/not-a-real-token');
    await expect(page.locator('p[role="alert"]')).toContainText(
      'This invitation link is malformed.',
    );
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  });
});
