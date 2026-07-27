import { expect, test } from '@playwright/test';

import { mailbox } from './mailpit';
import { capture, ingest, signedInClient, signInBrowser, uniqueEmail as seedEmail } from './seed';

/**
 * Phase 5 — the extractor-health page.
 *
 * The page exists to answer "which retailer is extraction failing on, and which adapter
 * version was responsible". These tests check both that it answers it and that it does not
 * answer anything else: no titles, no notes, no product URLs.
 */

const uniqueEmail = (label: string) => seedEmail('diag', label);

test.describe('extractor health', () => {
  test('groups by domain and names the adapter and version', async ({ page }) => {
    const email = uniqueEmail('groups');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(
      client,
      capture({
        url: 'https://shop.northwind.example/p/one',
        extractorId: 'shopify',
        extractorVersion: '1.0.0',
      }),
    );
    await ingest(
      client,
      capture({
        title: 'Second thing',
        url: 'https://shop.northwind.example/p/two',
        extractorId: 'shopify',
        extractorVersion: '1.0.0',
      }),
    );

    await signInBrowser(page, client);
    await page.getByRole('link', { name: 'Extractor health' }).click();
    await expect(page).toHaveURL(/\/app\/diagnostics$/);

    const domain = page.getByTestId('domain-health').filter({ hasText: 'shop.northwind.example' });
    await expect(domain).toHaveCount(1);
    await expect(domain).toContainText('2 items');
    await expect(domain.getByTestId('extractor-badge')).toHaveText('shopify@1.0.0 ×2');
    await expect(domain.getByTestId('failure-class').first()).toHaveAttribute('data-class', 'ok');
  });

  test('sorts a failing retailer above a healthy one and says how it failed', async ({ page }) => {
    const email = uniqueEmail('failing');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(client, capture({ url: 'https://healthy.example/p/1', extractorId: 'shopify' }));
    await ingest(
      client,
      capture({
        title: 'Ask in store',
        url: 'https://awkward.example/p/1',
        noPrice: true,
        availability: 'unknown',
        confidence: 0.3,
      }),
    );

    await signInBrowser(page, client);
    await page.goto('/app/diagnostics');

    const rows = page.getByTestId('domain-health');
    await expect(rows.first()).toHaveAttribute('data-domain', 'awkward.example');

    const failing = rows.filter({ hasText: 'awkward.example' });
    await expect(failing.getByTestId('failure-class')).toHaveAttribute('data-class', 'no_price');
    await expect(failing.getByTestId('presence-price')).toHaveText('0%');
    await expect(failing.getByTestId('presence-availability')).toHaveText('0%');
    await expect(failing).toContainText('mean confidence 0.30');
  });

  test('lists the adapters in the build with their versions', async ({ page }) => {
    const email = uniqueEmail('registry');
    const inbox = mailbox(email);

    await signInBrowser(page, await signedInClient(email, inbox));
    await page.goto('/app/diagnostics');

    // The registry renders whether or not anything has been saved.
    for (const adapter of [
      'shopify',
      'woocommerce',
      'magento',
      'bigcommerce',
      'salesforce-commerce-cloud',
    ]) {
      await expect(page.getByRole('cell', { name: adapter, exact: true })).toBeVisible();
    }
    await expect(
      page.getByText('Nothing saved yet, so there is nothing to diagnose.'),
    ).toBeVisible();
  });

  test('shows no product titles, notes, or URLs', async ({ page }) => {
    const email = uniqueEmail('private');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(
      client,
      capture({
        title: 'A very identifying present',
        url: 'https://shop.northwind.example/p/gift',
      }),
      { note: 'do not show this to anyone' },
    );

    await signInBrowser(page, client);
    await page.goto('/app/diagnostics');

    await expect(page.getByTestId('domain-health')).toContainText('shop.northwind.example');

    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toContain('A very identifying present');
    expect(body).not.toContain('do not show this to anyone');
    expect(body).not.toContain('/p/gift');
  });

  test("does not show another user their neighbour's retailers", async ({ page }) => {
    const owner = uniqueEmail('owner');
    const ownerInbox = mailbox(owner);
    const ownerClient = await signedInClient(owner, ownerInbox);
    await ingest(ownerClient, capture({ url: 'https://private-retailer.example/p/1' }));

    const stranger = uniqueEmail('stranger');
    const strangerInbox = mailbox(stranger);
    await signInBrowser(page, await signedInClient(stranger, strangerInbox));
    await page.goto('/app/diagnostics');

    await expect(page.getByText('private-retailer.example')).toHaveCount(0);
    await expect(
      page.getByText('Nothing saved yet, so there is nothing to diagnose.'),
    ).toBeVisible();
  });
});
