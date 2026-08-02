import { expect, test } from '@playwright/test';

import { mailbox } from './mailpit';
import { capture, ingest, signedInClient, signInBrowser, uniqueEmail as seedEmail } from './seed';

/**
 * Phase 4 — what a second observation looks like on the dashboard.
 *
 * The database tests already prove the observation rules; these prove the user is told.
 * Timestamps are supplied by the fixture captures rather than by waiting, so "a week ago"
 * is deterministic.
 */

const uniqueEmail = (label: string) => seedEmail('hist', label);

/** An ISO timestamp `hours` before now. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

test.describe('price history and staleness', () => {
  test('shows how far the price has moved since the last different observation', async ({
    page,
  }) => {
    const email = uniqueEmail('drop');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(client, capture({ price: '98.00', observedAt: hoursAgo(6) }), {
      note: 'watching this',
    });
    const second = await ingest(
      client,
      capture({ price: '88.00', observedAt: hoursAgo(1) }),
      {},
      'revisit',
    );
    expect(second.observationInserted).toBe(true);

    await signInBrowser(page, client);

    const card = page.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner' });
    const change = card.getByTestId('price-change');

    await expect(change).toHaveAttribute('data-direction', 'down');
    await expect(change).toContainText('$10.00');
    await expect(change).toContainText('10%');
    // The refresh left the user's note alone.
    await expect(card).toContainText('watching this');
  });

  test('says nothing about a price that has not moved', async ({ page }) => {
    const email = uniqueEmail('flat');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(client, capture({ price: '98.00', observedAt: hoursAgo(6) }));
    // Same price, different availability: an observation is recorded, but there is no price
    // move to report.
    await ingest(
      client,
      capture({ price: '98.00', availability: 'out_of_stock', observedAt: hoursAgo(1) }),
      {},
      'revisit',
    );

    await signInBrowser(page, client);

    const card = page.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner' });
    await expect(card).toContainText('Out of stock');
    await expect(card.getByTestId('price-change')).toHaveCount(0);
  });

  test('marks an item whose price has not been re-observed for weeks', async ({ page }) => {
    const email = uniqueEmail('stale');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(client, capture({ title: 'Long forgotten', observedAt: hoursAgo(24 * 30) }));

    await signInBrowser(page, client);

    const card = page.getByRole('listitem').filter({ hasText: 'Long forgotten' });
    const age = card.getByTestId('freshness');

    await expect(age).toHaveAttribute('data-level', 'stale');
    await expect(age).toContainText('Price may be out of date');
  });

  test('does not call a just-observed item stale', async ({ page }) => {
    const email = uniqueEmail('fresh');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(client, capture({ title: 'Just checked' }));

    await signInBrowser(page, client);

    const card = page.getByRole('listitem').filter({ hasText: 'Just checked' });
    await expect(card.getByTestId('freshness')).toHaveAttribute('data-level', 'fresh');
  });

  test('lists every observation in the detail drawer, with its source', async ({ page }) => {
    const email = uniqueEmail('detail');
    const inbox = mailbox(email);

    const client = await signedInClient(email, inbox);
    await ingest(client, capture({ price: '98.00', observedAt: hoursAgo(8) }));
    await ingest(client, capture({ price: '88.00', observedAt: hoursAgo(4) }), {}, 'revisit');
    // An identical revisit must not add a third line.
    const repeat = await ingest(
      client,
      capture({ price: '88.00', observedAt: hoursAgo(1) }),
      {},
      'revisit',
    );
    expect(repeat.observationInserted).toBe(false);

    await signInBrowser(page, client);

    const card = page.getByRole('listitem').filter({ hasText: 'Meridian Wool Runner' });
    await card.getByRole('button', { name: 'Details' }).click();

    const drawer = page.getByRole('dialog');
    const history = drawer.getByRole('list', { name: 'Price history' });

    await expect(history.getByRole('listitem')).toHaveCount(2);
    await expect(history.getByRole('listitem').first()).toContainText('$88.00');
    await expect(history.getByRole('listitem').first()).toContainText('revisited');
    await expect(history.getByRole('listitem').last()).toContainText('$98.00');
    await expect(history.getByRole('listitem').last()).toContainText('saved');
  });
});
