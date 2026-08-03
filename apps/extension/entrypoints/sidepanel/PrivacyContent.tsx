/**
 * What the extension reads, and what it does not.
 *
 * This is where the sentence 2A took out of the header ended up. In the header it was a
 * permissions notice written for whoever reviews the manifest, sitting in the most valuable
 * space on the product's most important surface. Here it can be the thing a person actually
 * wants when they wonder what they just installed — and it can take the room to answer
 * properly.
 *
 * Every claim below is a claim about the code, not a promise about intent:
 *   - "only when you ask" is `activeTab`, which Chrome grants on invocation and revokes on
 *     navigation (lib/manifest.ts).
 *   - "never your cookies" is that nothing reads `document.cookie` and no host permission is
 *     held at rest (lib/manifest.test.ts pins the permission list).
 *   - the captured field list is `ProductCaptureV1` (BUILD_PLAN.md §6.1) — if that type gains
 *     a field, this list is wrong and must change with it.
 */

/** Exactly the fields `ProductCaptureV1` carries, in the order a person would look for them. */
const CAPTURED_FIELDS = [
  'The product name, brand and description',
  'The price, any crossed-out original price, and the currency',
  'Whether it says in stock or out of stock',
  'The size, colour or other option you have selected',
  'The main product photograph',
  'The page address, and the retailer’s name',
  'The product codes the page publishes, where it publishes any',
] as const;

const NEVER_TOUCHED = [
  'Your cookies, or any account you are signed in to',
  'Your browsing history, or any other tab',
  'Card numbers, addresses, or anything on a checkout page',
  'The page you are on, until the moment you ask for it',
] as const;

export function PrivacyContent() {
  return (
    <div className="privacy">
      <p className="privacy__lede">
        Universal Cart is a shopping list. It reads a product page when you ask it to, and it is
        asleep the rest of the time.
      </p>

      <section className="privacy__group" aria-labelledby="privacy-reads">
        <h2 id="privacy-reads" className="privacy__heading">
          What it reads
        </h2>
        <p className="privacy__body">
          The page you are looking at, at the moment you press <strong>Capture this page</strong> —
          from the toolbar button, the keyboard shortcut, or the right-click menu. Chrome grants
          that permission for that one tab and takes it back as soon as the tab goes anywhere else.
          The extension holds no standing access to any website.
        </p>
        <ul className="privacy__list">
          {CAPTURED_FIELDS.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
        <p className="privacy__body">
          That is the whole list. The page’s HTML is not uploaded, and nothing is kept from a page
          you did not capture.
        </p>
      </section>

      <section className="privacy__group" aria-labelledby="privacy-never">
        <h2 id="privacy-never" className="privacy__heading">
          What it never touches
        </h2>
        <ul className="privacy__list privacy__list--never">
          {NEVER_TOUCHED.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="privacy__group" aria-labelledby="privacy-yours">
        <h2 id="privacy-yours" className="privacy__heading">
          Your saved items
        </h2>
        <p className="privacy__body">
          They belong to your account and are visible only to you, unless you share a cart with
          someone. You can delete any item, or your whole account, from the dashboard.
        </p>
      </section>
    </div>
  );
}
