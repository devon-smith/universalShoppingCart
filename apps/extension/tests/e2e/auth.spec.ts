import { expect, test } from './fixtures';
import { signInCodeFrom, waitForEmail } from './mailpit';

function uniqueEmail(label: string): string {
  return `ext-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

test.describe('side panel sign-in', () => {
  test('signs in with an emailed code and keeps the session in extension storage', async ({
    context,
    extensionId,
  }) => {
    const email = uniqueEmail('signin');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await expect(page.getByRole('heading', { level: 1, name: 'Universal Cart' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a code' }).click();

    const code = signInCodeFrom(await waitForEmail(email));
    await page.getByLabel(/6-digit code sent to/).fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Signed in: the capture surface appears, and the account menu holds the identity. The
    // header used to carry the address; it now carries the cart selector and the way out, and
    // identity moved behind the menu so the panel's most valuable space is the product's.
    await expect(page.getByRole('heading', { name: 'Save this product' })).toBeVisible();
    await page.getByRole('button', { name: 'Account and settings' }).click();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText('Nothing saved yet')).toBeVisible();

    // The session lives in extension-local storage, not in a cookie or in memory.
    const stored = await page.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      return Object.keys(all);
    });
    expect(stored).toContain('universal-cart-auth');

    // Reopening the panel recovers the session rather than asking again.
    await page.reload();
    await page.getByRole('button', { name: 'Account and settings' }).click();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeHidden();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // Sign-out really clears the stored session.
    const afterSignOut = await page.evaluate(async () => {
      const value = await chrome.storage.local.get('universal-cart-auth');
      return value['universal-cart-auth'] ?? null;
    });
    expect(afterSignOut).toBeNull();
  });

  test('rejects a wrong code without signing anyone in', async ({ context, extensionId }) => {
    const email = uniqueEmail('badcode');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Email me a code' }).click();
    await waitForEmail(email);

    await page.getByLabel(/6-digit code sent to/).fill('000000');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden();
  });

  test('validates the email address before sending anything', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

    await page.locator('form').evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByRole('button', { name: 'Email me a code' }).click();

    await expect(page.getByRole('alert')).toContainText('Enter a valid email address.');
  });

  test('requests only the permissions the implemented features need', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    // Read it from the running extension rather than from disk, so this asserts on what
    // Chrome actually loaded.
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const manifest = await page.evaluate(() => {
      return chrome.runtime.getManifest() as unknown as {
        permissions: string[];
        host_permissions?: string[];
        manifest_version: number;
      };
    });

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions.sort()).toEqual([
      'activeTab',
      'contextMenus',
      'identity',
      'scripting',
      'sidePanel',
      'storage',
    ]);

    // This is the end-to-end build, which grants loopback access only; a release build
    // grants no host permission at all, asserted in lib/manifest.test.ts.
    expect(manifest.host_permissions ?? []).toEqual(['http://127.0.0.1/*']);
  });
});
