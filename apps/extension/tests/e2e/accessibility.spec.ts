import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { signInCodeFrom, waitForEmail } from './mailpit';

/**
 * Phase 5: the side panel operated entirely by keyboard.
 *
 * Every assertion here is about where `document.activeElement` ends up after the panel has
 * replaced part of itself — a value becoming a control, a subview replacing the whole tree.
 * Those are the moments a panel silently drops focus onto `<body>`, and in a 320-pixel column
 * a keyboard user who loses their place has to tab from the top to find it again.
 */

const fixtureOrigin = `http://127.0.0.1:${process.env.FIXTURE_SERVER_PORT ?? 3200}`;

function uniqueEmail(label: string): string {
  return `a11y-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function clickWithoutFocus(page: Page, selector: string) {
  await page.locator(selector).dispatchEvent('click');
}

async function signIn(panel: Page, email: string) {
  await panel.getByLabel('Email address').fill(email);
  await panel.getByRole('button', { name: 'Email me a code' }).click();

  const code = signInCodeFrom(await waitForEmail(email));
  await panel.getByLabel(/6-digit code sent to/).fill(code);
  await panel.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(panel.getByRole('heading', { name: 'Save this product' })).toBeVisible();
}

/** What the keyboard is on, described so a failure names the control rather than a tag. */
function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) return { tag: 'BODY', name: '', id: '' };
    return {
      tag: element.tagName,
      name: (
        element.getAttribute('aria-label') ??
        (element as HTMLInputElement).labels?.[0]?.textContent ??
        element.textContent ??
        ''
      )
        .trim()
        .slice(0, 60),
      id: element.id,
    };
  });
}

test.describe('the panel by keyboard', () => {
  /**
   * Turning a displayed value into an editable one unmounts the button that was pressed.
   *
   * Flagged fields already render as controls and already take focus. This is the other path:
   * a value the extractor was confident about, which the user wants to correct anyway. The
   * affordance is an icon button that replaces itself with an input — and focus does not
   * follow a removed element, it falls to `<body>`.
   */
  test('editing a value the extractor was sure about moves focus into the field', async ({
    context,
    extensionId,
  }) => {
    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/json-ld-complete.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, uniqueEmail('edit-focus'));

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');
    await expect(panel.getByTestId('preview-title')).toHaveText('Meridian Wool Runner');

    await panel.getByRole('button', { name: 'Edit title' }).click();
    expect(await focused(panel)).toMatchObject({ tag: 'INPUT', name: 'Title' });

    await panel.getByRole('button', { name: 'Edit price' }).click();
    expect(await focused(panel)).toMatchObject({ tag: 'INPUT', name: 'Price' });
  });

  /**
   * Settings and privacy replace the panel rather than expanding inside it, so each arrival
   * is a navigation and has to say where the user landed. Coming *back* is different: the
   * user is returning to a screen they know, and the useful place for the keyboard is the
   * link they followed, not the top of the page.
   */
  test('subviews announce arrival and hand focus back on the way out', async ({
    context,
    extensionId,
  }) => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, uniqueEmail('subviews'));

    const account = panel.getByRole('button', { name: 'Account and settings' });
    await account.click();
    expect(await focused(panel)).toMatchObject({ id: 'settings-heading' });

    const privacyLink = panel.getByRole('button', { name: 'What Universal Cart can see' });
    await privacyLink.click();
    expect(await focused(panel)).toMatchObject({ id: 'privacy-heading' });

    // Back to settings: the keyboard returns to the link, not to the heading.
    await panel.getByRole('button', { name: 'Settings' }).click();
    await expect(privacyLink).toBeFocused();

    // Back to the panel: the keyboard returns to the button that opened settings.
    await panel.getByRole('button', { name: 'Back' }).click();
    await expect(account).toBeFocused();
  });

  /**
   * The panel used to print `⌘⇧U` literally. That is the macOS suggestion and nothing else:
   * a Windows user read a key they do not have. `chrome.commands` knows the real binding,
   * and the hint is absent rather than wrong when there is none.
   */
  test('the capture hint names the binding this browser actually has', async ({
    context,
    extensionId,
  }) => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, uniqueEmail('shortcut'));

    const hint = panel.locator('.capture__hint');
    const settings = panel.getByRole('button', { name: 'Account and settings' });

    // Whatever Chrome reports for this command, the two surfaces agree — neither is a
    // hardcoded string that could drift from the other or from the browser.
    const shown = (await hint.count()) === 1 ? await hint.locator('kbd').textContent() : null;

    await settings.click();
    const settingsShortcut = panel.locator('.settings__body kbd');
    if (shown === null) {
      await expect(settingsShortcut).toHaveCount(0);
    } else {
      await expect(settingsShortcut).toHaveText(shown);
      expect(shown.trim().length).toBeGreaterThan(0);
    }
  });

  /**
   * One event, one announcement.
   *
   * Reading a page finishes without a click, so the outcome is announced. The amber callout
   * repeats the same instruction visually; when it was also a live region, a screen reader
   * queued both and said the same thing twice.
   */
  test('a low-confidence capture announces once, not twice', async ({ context, extensionId }) => {
    // `sparse.html` states nothing the extractor can trust, so every field is flagged.
    const product = await context.newPage();
    await product.goto(`${fixtureOrigin}/sparse.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await signIn(panel, uniqueEmail('announce'));

    await product.bringToFront();
    await clickWithoutFocus(panel, 'button:has-text("Capture this page")');

    // The visible callout is still there — it is how a sighted user sees which fields to
    // check — it simply no longer announces itself on top of the panel's own message.
    await expect(panel.getByText(/Check the highlighted fields/)).toBeVisible();
    await expect(panel.getByRole('status')).toHaveCount(0);

    const live = panel.locator('[aria-live="polite"]');
    await expect(live).toHaveCount(1);
    await expect(live).toContainText(/needs? checking/);
  });
});
