/**
 * Contrast arithmetic, so the design system's claims are checked rather than asserted.
 *
 * `tokens.css` carries a comment saying every colour pair "was measured rather than assumed".
 * That was true when it was written, and a comment cannot stay true on its own — the ratios
 * age silently the moment a token moves. This module exists so `contrast.test.ts` can
 * re-derive them from the stylesheet on every run.
 *
 * The maths is WCAG 2.x §1.4.3: relative luminance from linearised sRGB, then
 * `(lighter + 0.05) / (darker + 0.05)`. Nothing here is approximate.
 */

export type Rgb = readonly [number, number, number];

/** `#rgb` or `#rrggbb` to channel values in 0–255. Throws rather than guess at anything else. */
export function parseHex(value: string): Rgb {
  const hex = value.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${value}`);
  }

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ] as const;
}

/**
 * A translucent colour as it will actually be seen.
 *
 * A ratio computed against the token itself, ignoring its alpha, is the mistake that let a
 * 40%-opacity focus ring look like it measured 7.5 when what reaches the eye measured 2.0.
 */
export function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map(
    (i) => alpha * foreground[i]! + (1 - alpha) * background[i]!,
  ) as unknown as Rgb;
}

export function relativeLuminance(colour: Rgb): number {
  const [r, g, b] = colour.map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  }) as unknown as Rgb;

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/**
 * The thresholds, named so a test reads as the rule it is enforcing.
 *
 * `NON_TEXT` covers the outline of a control, a focus indicator, and a chart stroke — WCAG
 * 1.4.11. `TEXT` is 1.4.3 at normal size; large text is allowed 3:1 but nothing in this
 * product relies on that, so it is deliberately absent.
 */
export const CONTRAST = { TEXT: 4.5, NON_TEXT: 3 } as const;

/**
 * Pull `--uc-*: #hex` declarations out of one CSS block.
 *
 * A deliberately small parser: it reads the block starting at `selector` and takes only
 * single hex values, which is every colour token. Shadows and font stacks are skipped
 * because they do not match, not because they are filtered — so a token that stops being a
 * plain colour disappears from the map and fails the test that names it, rather than being
 * silently misread.
 */
export function readTokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No such block: ${selector}`);

  const open = css.indexOf('{', start);
  const end = css.indexOf('}', open);
  if (open === -1 || end === -1) throw new Error(`Unterminated block: ${selector}`);

  const body = css.slice(open + 1, end);
  const tokens: Record<string, string> = {};

  for (const [, name, value] of body.matchAll(/(--uc-[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[name!] = value!;
  }

  return tokens;
}
