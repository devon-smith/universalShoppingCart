import { expect, test } from '@playwright/test';

import { mailbox, signInCodeFrom, signInUrlFrom } from './mailpit';

/** A fresh address per test keeps runs independent without resetting the database. */
function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe('route protection', () => {
  test('sends an anonymous visitor from /app to /login and remembers where they were going', async ({
    page,
  }) => {
    await page.goto('/app');

    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });

  test('offers both Google and email sign-in', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible();
  });

  test('rejects an off-origin next parameter', async ({ page }) => {
    await page.goto('/login?next=https://evil.example.com');

    // The form carries the sanitized value, not the attacker's.
    await expect(page.locator('input[name="next"]').first()).toHaveValue('/app');
  });
});

test.describe('magic-link sign-in', () => {
  test('signs a new user in, creates their default cart, and signs them out again', async ({
    page,
  }) => {
    const email = uniqueEmail('magic');
    const inbox = mailbox(email);

    await page.goto('/login?next=%2Fapp');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

    await expect(page.locator('p[role="status"]')).toContainText(email);

    await page.goto(signInUrlFrom(await inbox.next()));

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

    // The signup trigger created exactly one cart, and it is the default.
    const carts = page.getByRole('list').getByRole('listitem');
    await expect(carts).toHaveCount(1);
    await expect(carts.first()).toContainText('My cart');
    await expect(carts.first()).toContainText('Default');

    // A signed-in user has no reason to see the login page.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/app$/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // The session is really gone, not merely hidden.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);
  });

  test('reuses the same account and cart on a second sign-in', async ({ page }) => {
    const email = uniqueEmail('repeat');
    const inbox = mailbox(email);

    for (const attempt of [1, 2]) {
      if (attempt > 1) {
        // Supabase throttles repeat sign-in emails to one per `auth.email.max_frequency`
        // (1s locally). Waiting it out keeps the test about account reuse rather than
        // about the throttle, which has its own assertion below.
        await page.waitForTimeout(1_500);
      }

      await page.goto('/login');
      await page.getByLabel('Email address').fill(email);
      await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
      await expect(page.locator('p[role="status"]')).toContainText(email);

      await page.goto(signInUrlFrom(await inbox.next()));
      await expect(page).toHaveURL(/\/app$/);

      const carts = page.getByRole('list').getByRole('listitem');
      await expect(carts, `attempt ${attempt} should still see exactly one cart`).toHaveCount(1);

      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test('emails a 6-digit code for signing in from the extension', async ({ page }) => {
    const email = uniqueEmail('code');
    const inbox = mailbox(email);

    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.locator('p[role="status"]')).toContainText(email);

    // The extension cannot follow a link into a browser tab, so the same email carries
    // a code the side panel can verify. See apps/extension/lib/auth/email-otp.ts.
    expect(signInCodeFrom(await inbox.next())).toMatch(/^\d{6}$/);
  });

  test('surfaces the send throttle rather than silently doing nothing', async ({ page }) => {
    const email = uniqueEmail('throttle');

    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.locator('p[role="status"]')).toContainText(email);

    // Immediately asking again trips Supabase's per-address send throttle.
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

    await expect(page.locator('p[role="alert"]')).toContainText(/only request this after/i);
  });

  test('rejects an email address that is not one', async ({ page }) => {
    await page.goto('/login');
    // `novalidate` bypasses the browser's own check so the server-side guard is exercised.
    await page
      .locator('form')
      .filter({ hasText: 'Email me a sign-in link' })
      .evaluate((form) => {
        (form as HTMLFormElement).noValidate = true;
      });
    await page.getByLabel('Email address').fill('definitely-not-an-email');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();

    await expect(page.locator('p[role="alert"]')).toContainText('Enter a valid email address.');
  });

  test('reports an invalid confirmation link instead of signing anyone in', async ({ page }) => {
    await page.goto('/auth/confirm?token_hash=not-a-real-token&type=email');

    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.locator('p[role="alert"]')).toBeVisible();
  });
});
