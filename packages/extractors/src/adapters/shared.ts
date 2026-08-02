import { normalizeText } from '../normalizers/text';

/**
 * Helpers shared by the retailer-platform adapters.
 *
 * Nothing here is platform-specific; it is the small amount of plumbing every adapter
 * needs — reading an embedded JSON blob without trusting its shape, and converting the
 * integer-cents representation some platforms use into an exact decimal string.
 */

/**
 * Parse a `<script type="application/json">` block.
 *
 * `JSON.parse`, never `eval` and never `new Function`: a product page is untrusted input
 * and the extension ships with a strict CSP (BUILD_PLAN.md §17.4). A malformed block is
 * `null`, not a thrown error — one broken script must not cost the whole capture.
 */
export function readJsonScript(document: Document, ...selectors: string[]): unknown {
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const text = element.textContent?.trim();
      if (!text) continue;

      try {
        return JSON.parse(text);
      } catch {
        // Try the next candidate rather than giving up on the page.
      }
    }
  }

  return null;
}

/** Parse a JSON value out of an attribute, e.g. WooCommerce's `data-product_variations`. */
export function readJsonAttribute(element: Element | null, attribute: string): unknown {
  const raw = element?.getAttribute(attribute)?.trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a string property, treating empty and non-string values as absent. */
export function stringProp(source: unknown, key: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === 'string' ? normalizeText(value) : null;
}

export function numberProp(source: unknown, key: string): number | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function arrayProp(source: unknown, key: string): unknown[] {
  if (!isRecord(source)) return [];
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A property that is a price, in whatever form the platform wrote it.
 *
 * Returned unconverted so `normalizePrice` sees the original: a JSON number reaching this
 * point has already lost whatever precision it was going to lose, and stringifying it here
 * would only hide that.
 */
export function moneyProp(source: unknown, key: string): string | number | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return typeof value === 'string' ? (normalizeText(value) ?? null) : null;
}

/**
 * Integer minor units to a decimal string: `9800` → `"98.00"`.
 *
 * Shopify and several other platforms publish prices as integer cents. Dividing by 100 in
 * JavaScript would route exact money through a double, which is the one thing the money
 * rules in this project forbid — so the conversion is done by moving the decimal point in
 * the string.
 */
export function minorUnitsToDecimal(input: unknown): string | null {
  const digits =
    typeof input === 'number' && Number.isSafeInteger(input) && input >= 0
      ? String(input)
      : typeof input === 'string' && /^\d+$/.test(input.trim())
        ? input.trim()
        : null;

  if (digits === null) return null;

  const padded = digits.padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

/** Text content of the first matching element. */
export function textOf(root: ParentNode, ...selectors: string[]): string | null {
  for (const selector of selectors) {
    const text = normalizeText(root.querySelector(selector)?.textContent);
    if (text) return text;
  }
  return null;
}

/** An attribute value from the first matching element that carries it. */
export function attrOf(root: ParentNode, attribute: string, ...selectors: string[]): string | null {
  for (const selector of selectors) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      const value = normalizeText(element.getAttribute(attribute));
      if (value) return value;
    }
  }
  return null;
}

/**
 * Turn a platform attribute code into something a person would recognise.
 *
 * `attribute_pa_shoe-size` → `Shoe size`. Deliberately conservative: it strips known
 * platform prefixes and separators and capitalizes, but never renames.
 */
export function humanizeAttributeCode(code: string): string | null {
  const stripped = code
    .replace(/^attribute_/i, '')
    .replace(/^pa_/i, '')
    .replace(/^super_attribute_/i, '')
    .replace(/[_-]+/g, ' ');

  const text = normalizeText(stripped);
  if (!text || text.length > 40) return null;

  return text.charAt(0).toUpperCase() + text.slice(1);
}
