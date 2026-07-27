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

/** Query parameters that are option-like rather than tracking or routing. */
const VARIANT_PARAMETER_NAMES = new Set([
  'color',
  'colour',
  'size',
  'style',
  'storage',
  'capacity',
  'material',
  'finish',
  'length',
  'width',
  'flavor',
  'flavour',
  'scent',
  'variant',
  'variation',
]);

/** Words that appear in option group labels but are not part of the option name. */
const LABEL_NOISE = /\s*[:：]\s*$|\s*\(required\)\s*$|\s*\*\s*$/i;

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
    if (name) variant[name] = value;
  }

  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'))) {
    if (!input.checked && !input.hasAttribute('checked')) continue;

    const name = groupLabelFor(input, document) ?? cleanLabel(input.getAttribute('name'));
    const value =
      normalizeText(input.getAttribute('data-value')) ??
      normalizeText(labelTextFor(input, document)) ??
      normalizeText(input.value);

    if (name && value) variant[name] = value;
  }

  for (const element of Array.from(
    root.querySelectorAll('[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"]'),
  )) {
    const name = groupLabelFor(element, document);
    const value =
      normalizeText(element.getAttribute('aria-label')) ?? normalizeText(element.textContent);
    if (name && value && !(name in variant)) variant[name] = value;
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
    if (!VARIANT_PARAMETER_NAMES.has(name)) continue;

    const value = normalizeText(rawValue);
    if (!value) continue;

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
