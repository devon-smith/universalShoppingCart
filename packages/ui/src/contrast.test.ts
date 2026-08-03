import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTRAST,
  composite,
  contrastRatio,
  parseHex,
  readTokens,
  relativeLuminance,
} from './contrast';

/**
 * The design system's contrast claims, re-measured from `tokens.css` on every run.
 *
 * The header comment in that file says every pair "was measured rather than assumed". This is
 * what keeps that sentence true. A comment recording a ratio is accurate exactly once; the
 * next person to nudge a hex value has no way to know which sentence they have just falsified.
 *
 * The pairs below are not a sample. They are every combination the interface actually renders:
 * each text colour on each surface it appears on, and each non-text mark — control outline,
 * focus ring, sparkline stroke, target-price bar — against what sits behind it.
 */

// Read as a file rather than imported: the point is to measure what ships in the stylesheet,
// not a copy of the values transcribed into TypeScript. (`import.meta.url` is not a file URL
// under the jsdom environment these tests run in, so the path comes from the package root.)
const css = readFileSync(resolve(process.cwd(), 'src/tokens.css'), 'utf8');

const THEMES = {
  light: readTokens(css, ":root[data-theme='light']"),
  dark: readTokens(css, ":root[data-theme='dark']"),
} as const;

/** `[label, foreground token, background token, minimum]`. */
type Pair = readonly [string, string, string, number];

const TEXT_PAIRS: readonly Pair[] = [
  ['body text on background', '--uc-foreground', '--uc-background', CONTRAST.TEXT],
  ['body text on surface', '--uc-foreground', '--uc-surface', CONTRAST.TEXT],
  ['body text on elevated surface', '--uc-foreground', '--uc-surface-elevated', CONTRAST.TEXT],
  ['body text on muted surface', '--uc-foreground', '--uc-surface-muted', CONTRAST.TEXT],
  ['muted text on background', '--uc-foreground-muted', '--uc-background', CONTRAST.TEXT],
  ['muted text on surface', '--uc-foreground-muted', '--uc-surface', CONTRAST.TEXT],
  [
    'muted text on elevated surface',
    '--uc-foreground-muted',
    '--uc-surface-elevated',
    CONTRAST.TEXT,
  ],
  ['muted text on muted surface', '--uc-foreground-muted', '--uc-surface-muted', CONTRAST.TEXT],
  // The three semantic colours, each as text on every surface a badge or callout uses.
  ['success text on background', '--uc-success', '--uc-background', CONTRAST.TEXT],
  ['success text on elevated surface', '--uc-success', '--uc-surface-elevated', CONTRAST.TEXT],
  ['success text on muted surface', '--uc-success', '--uc-surface-muted', CONTRAST.TEXT],
  ['warning text on background', '--uc-warning', '--uc-background', CONTRAST.TEXT],
  ['warning text on elevated surface', '--uc-warning', '--uc-surface-elevated', CONTRAST.TEXT],
  ['warning text on muted surface', '--uc-warning', '--uc-surface-muted', CONTRAST.TEXT],
  ['danger text on background', '--uc-danger', '--uc-background', CONTRAST.TEXT],
  ['danger text on elevated surface', '--uc-danger', '--uc-surface-elevated', CONTRAST.TEXT],
  ['danger text on muted surface', '--uc-danger', '--uc-surface-muted', CONTRAST.TEXT],
  // `primary` is a link colour as well as a fill — the drawer's provenance disclosure.
  ['primary link on background', '--uc-primary', '--uc-background', CONTRAST.TEXT],
  ['primary link on elevated surface', '--uc-primary', '--uc-surface-elevated', CONTRAST.TEXT],
  // The one place a colour is used as a background for text.
  ['text on a primary fill', '--uc-primary-foreground', '--uc-primary', CONTRAST.TEXT],
];

const NON_TEXT_PAIRS: readonly Pair[] = [
  // The outline of anything a user clicks or types into (1.4.11).
  ['control outline on background', '--uc-border-strong', '--uc-background', CONTRAST.NON_TEXT],
  ['control outline on surface', '--uc-border-strong', '--uc-surface', CONTRAST.NON_TEXT],
  [
    'control outline on elevated surface',
    '--uc-border-strong',
    '--uc-surface-elevated',
    CONTRAST.NON_TEXT,
  ],
  // Phase 4: the sparkline stroke, drawn on whatever the drawer sits on.
  ['sparkline stroke on background', '--uc-primary', '--uc-background', CONTRAST.NON_TEXT],
  [
    'sparkline stroke on elevated surface',
    '--uc-primary',
    '--uc-surface-elevated',
    CONTRAST.NON_TEXT,
  ],
  // Phase 4: the target-price bar, in both of its states, on its own track.
  ['target bar below target', '--uc-success', '--uc-surface-muted', CONTRAST.NON_TEXT],
  ['target bar above target', '--uc-primary', '--uc-surface-muted', CONTRAST.NON_TEXT],
  // The tinted edge of a callout, which is what distinguishes its tone at a glance.
  ['callout edge, warning', '--uc-warning', '--uc-surface-muted', CONTRAST.NON_TEXT],
  ['callout edge, danger', '--uc-danger', '--uc-surface-muted', CONTRAST.NON_TEXT],
  ['callout edge, success', '--uc-success', '--uc-surface-muted', CONTRAST.NON_TEXT],
];

describe.each(Object.entries(THEMES))('%s theme', (_theme, tokens) => {
  it.each(TEXT_PAIRS)('%s reaches %#', (label, fg, bg, min) => {
    const ratio = contrastRatio(parseHex(tokens[fg]!), parseHex(tokens[bg]!));
    expect(ratio, `${label}: ${tokens[fg]} on ${tokens[bg]}`).toBeGreaterThanOrEqual(min);
  });

  it.each(NON_TEXT_PAIRS)('%s reaches %#', (label, fg, bg, min) => {
    const ratio = contrastRatio(parseHex(tokens[fg]!), parseHex(tokens[bg]!));
    expect(ratio, `${label}: ${tokens[fg]} on ${tokens[bg]}`).toBeGreaterThanOrEqual(min);
  });

  /**
   * The focus ring, against the gap it is drawn outside of.
   *
   * `--uc-focus-ring` paints a 2px ring in `background` and then a 2px ring in `primary`
   * outside it, so the pair that has to reach 3:1 is primary-against-background — the ring
   * against its own inner gap — not primary against whatever the page happens to be.
   */
  it('draws a focus ring that reaches 3:1 against its inner gap', () => {
    const ratio = contrastRatio(
      parseHex(tokens['--uc-primary']!),
      parseHex(tokens['--uc-background']!),
    );
    expect(ratio).toBeGreaterThanOrEqual(CONTRAST.NON_TEXT);
  });
});

/**
 * The regression that prompted all of this.
 *
 * The ring used to be `primary` at 40% alpha. The token measured 7.51, so it looked settled;
 * what reached the eye measured 2.02. This asserts the two are the same thing now, which is
 * only true while the ring is opaque.
 */
describe('the focus ring is opaque', () => {
  it('declares no alpha, in any theme', () => {
    const declaration = /--uc-focus-ring:[^;]*;/g;
    const found = [...css.matchAll(declaration)].map((match) => match[0]);

    expect(found).toHaveLength(1);
    expect(found[0]).not.toMatch(/\/\s*\d+%/);
    expect(found[0]).toContain('var(--uc-primary)');
  });

  it('would have failed on the value it replaced', () => {
    // 40% of primary over the background it is drawn on, which is what a browser painted.
    const seen = composite(parseHex('#4338ca'), parseHex('#faf9f7'), 0.4);
    expect(contrastRatio(seen, parseHex('#faf9f7'))).toBeLessThan(CONTRAST.NON_TEXT);
    // And the trap: the token on its own looks like it passes comfortably.
    expect(contrastRatio(parseHex('#4338ca'), parseHex('#faf9f7'))).toBeGreaterThan(7);
  });
});

describe('the two ways of asking for a theme agree', () => {
  /**
   * Dark is declared twice — once under `prefers-color-scheme` and once under
   * `[data-theme='dark']` — because an explicit choice has to beat the system preference in
   * both directions. Two hand-maintained copies of fourteen colours is precisely the thing
   * that drifts, and a drift would show up only as screenshots that disagree with the app.
   */
  it('declares the same dark palette in the media query and the attribute block', () => {
    expect(readTokens(css, '@media (prefers-color-scheme: dark)')).toEqual(THEMES.dark);
  });

  it('declares the same light palette in :root and the attribute block', () => {
    const base = readTokens(css, ':root {');
    for (const [name, value] of Object.entries(THEMES.light)) {
      expect(base[name], name).toBe(value);
    }
  });
});

describe('the arithmetic itself', () => {
  it('puts black on white at 21', () => {
    expect(contrastRatio(parseHex('#000000'), parseHex('#ffffff'))).toBeCloseTo(21, 5);
  });

  it('is symmetric', () => {
    const a = parseHex('#4338ca');
    const b = parseHex('#faf9f7');
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('puts a colour against itself at 1', () => {
    expect(contrastRatio(parseHex('#166534'), parseHex('#166534'))).toBeCloseTo(1, 10);
  });

  it('reads shorthand hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
  });

  it('refuses anything that is not a hex colour', () => {
    expect(() => parseHex('rgb(0 0 0)')).toThrow(/Not a hex colour/);
  });

  it('composites towards the backdrop as alpha falls', () => {
    const fg = parseHex('#000000');
    const bg = parseHex('#ffffff');
    expect(composite(fg, bg, 1)).toEqual([0, 0, 0]);
    expect(composite(fg, bg, 0)).toEqual([255, 255, 255]);
    expect(relativeLuminance(composite(fg, bg, 0.5))).toBeGreaterThan(relativeLuminance(fg));
  });

  it('names the block it cannot find rather than returning nothing', () => {
    expect(() => readTokens(css, ':root[data-theme="sepia"]')).toThrow(/No such block/);
  });
});
