import { normalizeText } from '../normalizers/text';

/**
 * Selected-variant detection (BUILD_PLAN.md §10.6).
 *
 * Reports only the options that are *currently selected*, never the full option matrix.
 * The distinction matters: storing every size a shoe comes in would describe the product
 * page, while storing the selected size describes what the user intends to buy.
 *
 * Signals, in order of reliability:
 * 1. `<select>` with a chosen `<option>`
 * 2. `input[type=radio]:checked` with a label
 * 3. `[aria-checked="true"]` / `[aria-pressed="true"]` / `[aria-selected="true"]`
 * 4. URL parameters whose names look like option names
 */

/**
 * Names that denote an option a shopper picks, rather than a fact about the goods.
 *
 * Used wherever a name arrives with **no evidence that anything was selected** — a URL
 * parameter, a schema.org `additionalProperty` — because there the name is all we have. A DOM
 * control is different and is not filtered by this list: a `<select>` the user operated is
 * itself the evidence, whatever its label says.
 *
 * `material` is deliberately absent. It reads like an option and is almost always a
 * characteristic: Zara, H&M and Uniqlo all publish composition this way. It gets a real field
 * at the comparison milestone (docs/DECISIONS.md, 2026-07-27) rather than a guessed slot here.
 */
const OPTION_NAMES = new Set([
  'color',
  'colour',
  'size',
  'style',
  'storage',
  'capacity',
  'finish',
  'length',
  'width',
  'fit',
  'flavor',
  'flavour',
  'scent',
  'variant',
  'variation',
]);

/** Does this name denote something chosen, rather than something measured or described? */
export function isOptionName(name: string): boolean {
  return OPTION_NAMES.has(name.trim().toLowerCase());
}

/** Words that appear in option group labels but are not part of the option name. */
const LABEL_NOISE = /\s*[:：]\s*$|\s*\(required\)\s*$|\s*\*\s*$/i;

/**
 * Controls that operate the page rather than describe the product.
 *
 * `selectedVariant` means "the options the user chose about this garment", and it is part of
 * what the fingerprint is built from (BUILD_PLAN.md §9.1) — so a review sort order landing in
 * it makes the same item hash two ways depending on how the page was left. Every entry here
 * was captured from a real page: Chewy contributed `Quantity`, `Sort By`, and two review
 * filters; Walmart contributed its shipping-versus-pickup chooser.
 *
 * Matched on the label the user reads rather than on class names or ids. That text is
 * conventional across retailers — a quantity selector says "Quantity" everywhere — which is
 * exactly what markup is not.
 *
 * Autoship-versus-buy-once is deliberately here too. It is a real choice and it changes the
 * price, but it is a subscription term rather than an attribute of the product, and treating
 * it as a variant would fingerprint one item as two.
 */
const CONTROL_LABELS: readonly RegExp[] = [
  /^(quantity|qty|amount)$/i,
  /^sort\b/i,
  /^filter\b/i,
  /^how do you want\b/i,
  /^(shipping|delivery|pickup|subscription)\b/i,
];

/**
 * Values that are a widget's state rather than an answer.
 *
 * An unvalued checkbox reports `on` when ticked, which says only that a box is ticked. H&M's
 * "Shipping online" toggle arrived as `on` and was invisible until the composition rows above
 * stopped outranking it.
 */
const CONTROL_VALUES = new Set(['on', 'off', 'true', 'false', 'checked', 'unchecked', 'yes', 'no']);

function isPageControl(name: string): boolean {
  return CONTROL_LABELS.some((pattern) => pattern.test(name));
}

function isControlState(value: string): boolean {
  return CONTROL_VALUES.has(value.trim().toLowerCase());
}

function cleanLabel(raw: string | null | undefined): string | null {
  const text = normalizeText(raw);
  if (!text) return null;

  // "Color: Natural Black" — the group name is everything before the colon.
  const beforeColon = text.split(/[:：]/)[0] ?? text;
  const cleaned = normalizeText(beforeColon.replace(LABEL_NOISE, ''));
  if (!cleaned || cleaned.length > 40) return null;
  return cleaned;
}

/**
 * Find `<label for="...">` without building a selector string.
 *
 * `CSS.escape` is not available in every DOM implementation these extractors run under
 * (jsdom, for one), and interpolating an unescaped id into a selector is a
 * query-injection bug waiting to happen.
 */
function labelElementFor(id: string, document: Document): Element | null {
  for (const label of Array.from(document.querySelectorAll('label[for]'))) {
    if (label.getAttribute('for') === id) return label;
  }
  return null;
}

function labelFor(element: Element, document: Document): string | null {
  const id = element.getAttribute('id');
  if (id) {
    const text = cleanLabel(labelElementFor(id, document)?.textContent);
    if (text) return text;
  }

  const wrapping = element.closest('label');
  if (wrapping) {
    const text = cleanLabel(wrapping.textContent);
    if (text) return text;
  }

  const ariaLabel = cleanLabel(element.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = document.getElementById(labelledBy);
    const text = cleanLabel(target?.textContent);
    if (text) return text;
  }

  const named = element.getAttribute('name') ?? element.getAttribute('data-option-name');
  return cleanLabel(named);
}

function groupLabelFor(element: Element, document: Document): string | null {
  const group = element.closest('[role="radiogroup"], fieldset, [data-option-name]');
  if (!group) return null;

  const dataName = cleanLabel(group.getAttribute('data-option-name'));
  if (dataName) return dataName;

  const ariaLabel = cleanLabel(group.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  const labelledBy = group.getAttribute('aria-labelledby');
  if (labelledBy) {
    const target = document.getElementById(labelledBy);
    const text = cleanLabel(target?.textContent);
    if (text) return text;
  }

  const legend = group.querySelector('legend');
  return cleanLabel(legend?.textContent);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Read selected options out of the DOM. */
export function extractSelectedVariantFromDom(root: ParentNode): Record<string, string> {
  const variant: Record<string, string> = {};

  // Controls are looked for inside the product region only — a sort dropdown or a review
  // filter elsewhere on the page is not something the user selected about this item. Label
  // resolution still uses the whole document, because `<label for>` may point anywhere.
  const document = ((root as Element).ownerDocument ?? root) as Document;

  for (const select of Array.from(root.querySelectorAll('select'))) {
    const option = select.querySelector<HTMLOptionElement>('option[selected]') ?? null;
    const chosen =
      option ?? (select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null);
    if (!chosen || chosen.disabled) continue;

    const value = normalizeText(chosen.textContent) ?? normalizeText(chosen.value);
    // Placeholder options ("Choose a size") carry no value and must not be reported.
    if (!value || !normalizeText(chosen.value)) continue;

    const name = labelFor(select, document) ?? groupLabelFor(select, document);
    if (name && !isPageControl(name) && !isControlState(value)) variant[name] = value;
  }

  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'))) {
    if (!input.checked && !input.hasAttribute('checked')) continue;

    const name = groupLabelFor(input, document) ?? cleanLabel(input.getAttribute('name'));
    const value =
      normalizeText(input.getAttribute('data-value')) ??
      normalizeText(labelTextFor(input, document)) ??
      normalizeText(input.value);

    if (name && value && !isPageControl(name) && !isControlState(value)) variant[name] = value;
  }

  for (const element of Array.from(
    root.querySelectorAll('[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"]'),
  )) {
    const name = groupLabelFor(element, document);
    const value =
      normalizeText(element.getAttribute('aria-label')) ?? normalizeText(element.textContent);
    if (name && value && !(name in variant) && !isPageControl(name) && !isControlState(value)) {
      variant[name] = value;
    }
  }

  return variant;
}

/** The visible text of a radio's own label, which is the option value, not the group. */
function labelTextFor(input: HTMLInputElement, document: Document): string | null {
  const id = input.getAttribute('id');
  if (id) {
    const text = normalizeText(labelElementFor(id, document)?.textContent);
    if (text) return text;
  }

  const wrapping = input.closest('label');
  return normalizeText(wrapping?.textContent);
}

/**
 * Parameter names that carry a retailer's variant id rather than a chosen option.
 *
 * Narrower than `OPTION_NAMES` on purpose: `?size=9` is an option whatever its value
 * looks like, but `?variant=47776291946739` is Shopify's row id for the selected
 * variant. Lululemon's `?color=76616` stays an (opaque) option for now — recovering its
 * human label needs `hasVariant` matching, which is deferred work, and moving it here
 * without that would silently drop the colour from the fingerprint.
 */
const VARIANT_ID_PARAMS = new Set(['variant', 'variation']);

/**
 * A value that identifies rather than describes: a long run of digits, or a hex-ish
 * token with at least one digit. "red", "36w-34l" and "harbour-blue" all fail this test
 * and stay readable options.
 */
function isOpaqueToken(value: string): boolean {
  return /^\d{6,}$/.test(value) || (/^[0-9a-f-]{8,}$/i.test(value) && /\d/.test(value));
}

/**
 * The retailer's id for the selected variant, when the URL carries one.
 *
 * This is the value that used to land in `selectedVariant` as `Variant=47776291946739` —
 * an identifier wearing an option's clothes. It belongs in `identifiers.variantId`,
 * where the fingerprint ranks it above a product-level `sku` (see fingerprint.ts), so
 * removing it from the variant map cannot make two sizes of one garment hash alike.
 */
export function extractVariantIdFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  for (const [rawName, rawValue] of parsed.searchParams) {
    if (!VARIANT_ID_PARAMS.has(rawName.toLowerCase())) continue;
    const value = normalizeText(rawValue);
    if (value && isOpaqueToken(value)) return value;
  }

  return null;
}

/** Read option-like parameters out of the page URL. */
export function extractSelectedVariantFromUrl(url: string): Record<string, string> {
  const variant: Record<string, string> = {};

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return variant;
  }

  for (const [rawName, rawValue] of parsed.searchParams) {
    const name = rawName.toLowerCase();
    if (!isOptionName(name)) continue;

    const value = normalizeText(rawValue);
    if (!value) continue;

    // An opaque token under `variant`/`variation` is the retailer's variant id, routed
    // to `identifiers.variantId` by the pipeline instead. A readable value stays an
    // option: `?variant=harbour-blue` genuinely names what the shopper picked.
    if (VARIANT_ID_PARAMS.has(name) && isOpaqueToken(value)) continue;

    variant[titleCase(name)] = value;
  }

  return variant;
}

/** DOM signals win over URL parameters, which can be stale after client-side updates. */
export function mergeVariants(
  fromDom: Record<string, string>,
  fromUrl: Record<string, string>,
): Record<string, string> {
  return { ...fromUrl, ...fromDom };
}
