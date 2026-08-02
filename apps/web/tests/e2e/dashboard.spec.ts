import { expect, test } from '@playwright/test';

import { mailbox, signInUrlFrom } from './mailpit';
import { capture, ingest, signedInClient, signInBrowser, uniqueEmail as seedEmail } from './seed';

/**
 * The dashboard half of the Phase 2B acceptance flow.
 *
 * A capture is ingested through the real RPC by a second client — standing in for the
 * extension, which has its own suite — and the dashboard is then checked in the browser.
 * Together the two suites cover "saved in the extension, visible on the web".
 */

const uniqueEmail = (label: string) => seedEmail('dash', label);

test.describe('dashboard', () => {
  test('shows a saved product with its price, variant, and note', async ({ page }) => {
    const email = uniqueEmail('shows');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    const result = await ingest(client, capture(), { note: 'for the trip', quantity: 2 });
    expect(result.created).toBe(true);

    await signInBrowser(page, client);

    const card = page.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('$98.00');
    await expect(card).toContainText('$120.00');
    await expect(card).toContainText('−18%');
    await expect(card).toContainText('Northwind');
    await expect(card).toContainText('Size: 10');
    await expect(card).toContainText('for the trip');
    await expect(card).toContainText('×2');
    await expect(card).toContainText('In stock');
  });

  test('shows a duplicate save as one refreshed item, keeping the note', async ({ page }) => {
    const email = uniqueEmail('dup');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(client, capture(), { note: 'keep me', quantity: 3 });

    // The same product and variant again, at a lower price.
    const second = await ingest(client, capture({ price: '88.00' }));
    expect(second.created).toBe(false);
    expect(second.observationInserted).toBe(true);

    await signInBrowser(page, client);

    const card = page.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('$88.00');
    // The refresh did not touch the user's own fields.
    await expect(card).toContainText('keep me');
    await expect(card).toContainText('×3');
  });

  test('says a price is unknown rather than showing a blank', async ({ page }) => {
    const email = uniqueEmail('unknown');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    const sparse = capture({ title: 'Ask in store' });
    sparse.offer = {
      priceAmount: null,
      originalPriceAmount: null,
      currency: null,
      availability: 'unknown',
    };
    await ingest(client, sparse);

    await signInBrowser(page, client);

    const card = page.getByRole('listitem').filter({ hasText: 'Ask in store' });
    await expect(card).toContainText('Price unknown');
    await expect(card).toContainText('Availability unknown');
  });

  test('shows the empty state before anything is saved', async ({ page }) => {
    const email = uniqueEmail('empty');
    const inbox = mailbox(email);

    await page.goto('/login?next=%2Fapp');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.locator('p[role="status"]')).toContainText(email);
    await page.goto(signInUrlFrom(await inbox.next()));

    await expect(page.getByText('Nothing saved yet')).toBeVisible();
    await expect(page.getByText('Capture this page')).toBeVisible();
  });

  test("does not show another user their neighbour's products", async ({ page }) => {
    const owner = uniqueEmail('owner');
    const ownerInbox = mailbox(owner);
    const ownerClient = await signedInClient(owner, ownerInbox);
    await ingest(ownerClient, capture({ title: 'Private purchase' }));

    const stranger = uniqueEmail('stranger');
    const strangerInbox = mailbox(stranger);
    await signInBrowser(page, await signedInClient(stranger, strangerInbox));

    await expect(page.getByText('Private purchase')).toHaveCount(0);
    await expect(page.getByText('Nothing saved yet')).toBeVisible();
  });
});
