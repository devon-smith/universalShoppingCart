import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy · Universal Cart',
  description: 'What Universal Cart reads, what it stores, and what it never touches.',
};

/**
 * The privacy page (BUILD_PLAN.md §12.1, §17.1).
 *
 * Every claim below is a claim about the code, not a promise about intent — the same
 * discipline as the extension's in-panel copy (entrypoints/sidepanel/PrivacyContent.tsx),
 * which this page extends with what the *service* stores. If `ProductCaptureV1` gains a
 * field, both lists are wrong and must change together.
 *
 * No claim of account self-deletion is made, because that flow does not exist yet: while
 * Universal Cart is in private testing, deletion is a request to whoever runs the instance.
 * Saying "delete your account in settings" before the button exists would be the exact kind
 * of overclaim this page exists to rule out.
 */

const CAPTURED_FIELDS = [
  'The product name, brand and description',
  'The price, any crossed-out original price, and the currency',
  'Whether it says in stock or out of stock',
  'The size, colour or other option you have selected',
  'The main product photograph (as its web address)',
  'The page address, and the retailer’s name',
  'The product codes the page publishes, where it publishes any',
] as const;

const NEVER_TOUCHED = [
  'Your cookies, or any account you are signed in to',
  'Your browsing history, or any other tab',
  'Card numbers, addresses, or anything on a checkout page',
  'Retailer passwords or payment details — there is nowhere to enter them',
  'The page you are on, until the moment you ask for it to be read',
] as const;

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link href="/" className="uc-wordmark w-fit text-xl tracking-tight">
          Universal Cart
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">What Universal Cart can see</h1>
        <p className="text-sm leading-relaxed text-[var(--uc-foreground-muted)]">
          Universal Cart is a shopping list. The browser extension reads a product page when you ask
          it to, and it is asleep the rest of the time.
        </p>
      </header>

      <section aria-labelledby="privacy-reads" className="flex flex-col gap-3">
        <h2 id="privacy-reads" className="text-lg font-semibold tracking-tight">
          What the extension reads
        </h2>
        <p className="text-sm leading-relaxed">
          The page you are looking at, at the moment you press <strong>Capture this page</strong> —
          from the toolbar button, the keyboard shortcut, or the right-click menu. Chrome grants
          that permission for that one tab and takes it back as soon as the tab goes anywhere else.
          The extension holds no standing access to any website.
        </p>
        <ul className="list-disc pl-5 text-sm leading-relaxed">
          {CAPTURED_FIELDS.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
        <p className="text-sm leading-relaxed">
          That is the whole list. The page’s HTML is not uploaded, and nothing is kept from a page
          you did not capture.
        </p>
      </section>

      <section aria-labelledby="privacy-never" className="flex flex-col gap-3">
        <h2 id="privacy-never" className="text-lg font-semibold tracking-tight">
          What it never touches
        </h2>
        <ul className="list-disc pl-5 text-sm leading-relaxed">
          {NEVER_TOUCHED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="privacy-stored" className="flex flex-col gap-3">
        <h2 id="privacy-stored" className="text-lg font-semibold tracking-tight">
          What the service stores
        </h2>
        <p className="text-sm leading-relaxed">
          Your email address (it is how you sign in — there are no passwords), the products you
          chose to save with the fields listed above, the notes, priorities, target prices and
          decisions you add to them, and a history of the prices that were observed so the app can
          show you how a price moved. Sign-ins and shared-cart membership changes are logged so
          unexpected access is noticeable.
        </p>
      </section>

      <section aria-labelledby="privacy-shared" className="flex flex-col gap-3">
        <h2 id="privacy-shared" className="text-lg font-semibold tracking-tight">
          Sharing
        </h2>
        <p className="text-sm leading-relaxed">
          Your saved items are visible only to you, unless you share a cart. A shared cart is
          visible to exactly the people it was shared with, with the role they were given, and
          removing someone removes their access immediately — the database enforces this, not the
          interface.
        </p>
      </section>

      <section aria-labelledby="privacy-delete" className="flex flex-col gap-3">
        <h2 id="privacy-delete" className="text-lg font-semibold tracking-tight">
          Deleting your data
        </h2>
        <p className="text-sm leading-relaxed">
          You can delete any saved item from the dashboard, permanently. While Universal Cart is in
          private testing there is no self-serve account deletion yet: ask the person who invited
          you, and the account and everything in it will be removed.
        </p>
      </section>
    </main>
  );
}
