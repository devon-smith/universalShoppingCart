#!/usr/bin/env tsx
/**
 * Score the extraction pipeline against saved real retailer pages.
 *
 * `.live/` holds working files — pages saved from a browser during a live-testing session,
 * not fixtures. Nothing there is sanitized and nothing there is committed. This script runs
 * the same pipeline the extension runs and prints which fields each page yields, so the
 * effect of an extraction change is visible across every page at once instead of one
 * recapture at a time.
 *
 *   pnpm score:live                        # score every page in .live/
 *   pnpm score:live --json                 # machine-readable
 *   pnpm score:live --save before.json     # record a baseline
 *   pnpm score:live --baseline before.json # score, and diff against that baseline
 *
 * Each page is `.live/<name>.html`. Its URL matters — canonical URL, domain, and variant
 * parameters all feed extraction — and is taken from, in order: a sidecar
 * `.live/<name>.json` containing `{"url": "..."}`, a `<link rel="canonical">` in the page,
 * or `og:url`. A page with no discoverable URL is reported rather than guessed at.
 *
 * ## Correctness, not just presence
 *
 * The ✓/· grid answers "did a value come out", which is not the same question as "is it
 * right" — a confidently wrong price shows ✓. That gap is what let an inert extraction
 * change look like it worked (docs/STATUS.md). So a page may also carry a truth sidecar,
 * `.live/<name>.truth.json`, holding the values a human read off the page:
 *
 *   { "price": "23.96", "currency": "USD", "original": null,
 *     "availability": "in_stock", "variant": { "Color": "Rumble Crumble" } }
 *
 * Each field is optional; only the ones present are checked. A value of `null` asserts the
 * field must be ABSENT — that is how "AeroPress labels its price a sale but shows no former
 * price" becomes a test that fails if the extractor invents one. The correctness section
 * counts SILENTLY WRONG (a present value that disagrees, or one fabricated where truth
 * says none) separately from MISSING, because the gate in docs/VALIDATION.md blocks on the
 * first and tolerates the second.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { JSDOM } from 'jsdom';

import { extractProductCapture } from '@universal-cart/extractors';

const repoRoot = resolve(import.meta.dirname, '..');
const liveDir = join(repoRoot, '.live');

/** Fields worth scoring, in the order a person reads a product card. */
const FIELDS = [
  ['title', (c) => c.product.title],
  ['price', (c) => c.offer.priceAmount],
  ['currency', (c) => c.offer.currency],
  ['original', (c) => c.offer.originalPriceAmount],
  ['image', (c) => c.product.selectedImageUrl],
  ['availability', (c) => (c.offer.availability === 'unknown' ? null : c.offer.availability)],
  ['variant', (c) => (Object.keys(c.selectedVariant).length > 0 ? 'yes' : null)],
];

/**
 * How each scalar truth field reads its extracted counterpart. `variant` is handled apart
 * because its truth is a map of expected options, not one value.
 */
const TRUTH_SCALARS = {
  title: (c) => c.product.title,
  price: (c) => c.offer.priceAmount,
  currency: (c) => c.offer.currency,
  original: (c) => c.offer.originalPriceAmount,
  availability: (c) => (c.offer.availability === 'unknown' ? null : c.offer.availability),
  image: (c) => (c.product.selectedImageUrl ? 'present' : null),
};

function parseArgs(argv) {
  const args = { json: false, save: null, baseline: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--save') args.save = argv[(i += 1)];
    else if (argv[i] === '--baseline') args.baseline = argv[(i += 1)];
  }
  return args;
}

/** The page's own URL, which extraction needs and must not be invented. */
function urlFor(name, document) {
  const sidecar = join(liveDir, `${name}.json`);
  if (existsSync(sidecar)) {
    try {
      const url = JSON.parse(readFileSync(sidecar, 'utf8')).url;
      if (typeof url === 'string' && url.length > 0) return url;
    } catch {
      // Fall through to the page's own markup.
    }
  }

  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (canonical) return canonical;

  return document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null;
}

/** The recorded truth for a page, or null when none was written. */
function truthFor(name) {
  const path = join(liveDir, `${name}.truth.json`);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A single field's verdict.
 *
 *   expected null  → the field must be absent; a value is a fabrication ('unexpected')
 *   expected value → equality after trimming ('ok' | 'wrong'), or 'missing' if nothing came out
 */
function verdictFor(expected, actual) {
  if (expected === null) {
    return actual === null || actual === undefined ? 'ok' : 'unexpected';
  }
  if (actual === null || actual === undefined) return 'missing';
  return String(actual).trim() === String(expected).trim() ? 'ok' : 'wrong';
}

/** Compare a capture against recorded truth, one entry per checked field. */
function checkTruth(capture, truth) {
  const checks = [];

  for (const [field, read] of Object.entries(TRUTH_SCALARS)) {
    if (!(field in truth)) continue;
    const expected = truth[field];
    const actual = read(capture) ?? null;
    checks.push({ field, expected, actual, verdict: verdictFor(expected, actual) });
  }

  if (truth.variant && typeof truth.variant === 'object') {
    const selected = capture.selectedVariant ?? {};
    // Case-insensitive key match, because a retailer's "Colour" is our "Color".
    const byLowerKey = new Map(
      Object.entries(selected).map(([key, value]) => [key.toLowerCase(), value]),
    );
    for (const [key, expected] of Object.entries(truth.variant)) {
      const actual = byLowerKey.get(key.toLowerCase()) ?? null;
      checks.push({
        field: `variant.${key}`,
        expected,
        actual,
        verdict: verdictFor(expected, actual),
      });
    }
  }

  return checks;
}

function scorePage(file) {
  const name = basename(file, '.html');
  const html = readFileSync(join(liveDir, file), 'utf8');
  const { window } = new JSDOM(html);
  const url = urlFor(name, window.document);

  if (!url) {
    return { name, error: 'no URL — add .live/' + name + '.json with {"url": "..."}' };
  }

  try {
    const result = extractProductCapture({ document: window.document, url });
    if (!result.ok) return { name, url, error: result.issues.join('; ') };

    const capture = result.capture;
    const fields = Object.fromEntries(
      FIELDS.map(([field, read]) => [field, read(capture) ?? null]),
    );

    const truth = truthFor(name);
    const checks = truth ? checkTruth(capture, truth) : null;

    return {
      name,
      url,
      domain: capture.source.domain,
      extractor: `${capture.extraction.extractorId}@${capture.extraction.extractorVersion}`,
      confidence: Number(capture.extraction.overallConfidence.toFixed(3)),
      fields,
      checks,
    };
  } catch (error) {
    return { name, url, error: error instanceof Error ? error.message : String(error) };
  }
}

function mark(value) {
  return value === null || value === undefined ? '·' : '✓';
}

function showValue(value) {
  return value === null || value === undefined ? '(absent)' : String(value);
}

function reportCorrectness(rows) {
  const checked = rows.filter((row) => !row.error && row.checks && row.checks.length > 0);
  if (checked.length === 0) {
    console.log(
      '\ncorrectness: no .live/<name>.truth.json sidecars found — presence only.\n' +
        '  Add one holding the values you read off the page to catch confidently-wrong output:\n' +
        '  { "price": "23.96", "original": null, "variant": { "Color": "Rumble Crumble" } }',
    );
    return;
  }

  console.log('\ncorrectness (pages with a truth sidecar):');

  const wrong = [];
  const unexpected = [];
  const missing = [];
  let ok = 0;

  for (const row of checked) {
    for (const check of row.checks) {
      const label = `${row.name} ${check.field}`;
      if (check.verdict === 'ok') {
        ok += 1;
      } else if (check.verdict === 'wrong') {
        wrong.push(label);
        console.log(
          `  WRONG       ${label}: extracted ${showValue(check.actual)}, truth ${showValue(check.expected)}`,
        );
      } else if (check.verdict === 'unexpected') {
        unexpected.push(label);
        console.log(
          `  FABRICATED  ${label}: extracted ${showValue(check.actual)}, truth says none`,
        );
      } else {
        missing.push(label);
        console.log(
          `  missing     ${label}: truth ${showValue(check.expected)}, extracted nothing`,
        );
      }
    }
  }

  const silentlyWrong = wrong.length + unexpected.length;
  console.log();
  console.log(
    `  SILENTLY WRONG: ${silentlyWrong}` +
      (silentlyWrong > 0
        ? `   (${[...wrong, ...unexpected].join(', ')})`
        : '   — the gate is this number'),
  );
  console.log(`  missing:        ${missing.length}`);
  console.log(`  ok:             ${ok}`);
}

function report(rows, baseline) {
  const width = Math.max(12, ...rows.map((row) => row.name.length));
  const header = ['page'.padEnd(width), 'extractor'.padEnd(22), 'conf', ...FIELDS.map(([f]) => f)];
  console.log(header.join('  '));
  console.log('-'.repeat(header.join('  ').length));

  for (const row of rows) {
    if (row.error) {
      console.log(`${row.name.padEnd(width)}  ${'—'.padEnd(22)}  —     ${row.error}`);
      continue;
    }
    const cells = FIELDS.map(([field]) => mark(row.fields[field]).padEnd(field.length));
    console.log(
      [
        row.name.padEnd(width),
        row.extractor.padEnd(22),
        String(row.confidence).padEnd(5),
        ...cells,
      ].join('  '),
    );
  }

  console.log();
  const scored = rows.filter((row) => !row.error);
  for (const [field] of FIELDS) {
    const have = scored.filter((row) => row.fields[field] !== null).length;
    console.log(`  ${field.padEnd(14)} ${have}/${scored.length}`);
  }

  const noPrice = scored.filter((row) => row.fields.price === null);
  if (noPrice.length > 0) {
    console.log(`\n  no price: ${noPrice.map((row) => row.name).join(', ')}`);
  }

  const failed = rows.filter((row) => row.error);
  if (failed.length > 0) {
    console.log(`  failed:   ${failed.map((row) => row.name).join(', ')}`);
  }

  reportCorrectness(rows);

  if (!baseline) return;

  console.log('\nagainst baseline:');
  const before = new Map(baseline.map((row) => [row.name, row]));
  let changes = 0;

  for (const row of scored) {
    const prior = before.get(row.name);
    if (!prior || prior.error) continue;

    for (const [field] of FIELDS) {
      const was = prior.fields?.[field] ?? null;
      const now = row.fields[field] ?? null;
      if (was === now) continue;
      changes += 1;
      const direction = was === null ? 'GAINED' : now === null ? 'LOST  ' : 'CHANGED';
      console.log(`  ${direction}  ${row.name} ${field}: ${was ?? '·'} -> ${now ?? '·'}`);
    }
  }

  if (changes === 0) console.log('  no field-level changes');
}

const args = parseArgs(process.argv.slice(2));

if (!existsSync(liveDir)) {
  console.error('.live/ does not exist. Create it and save pages there first.');
  process.exit(1);
}

const files = readdirSync(liveDir).filter((file) => file.endsWith('.html'));

if (files.length === 0) {
  console.error(
    '.live/ holds no .html pages yet.\n\n' +
      'For each page: select the variant, open DevTools, and run in the Console\n' +
      '  copy(document.documentElement.outerHTML)\n' +
      'then paste it into .live/<name>.html.\n\n' +
      'Add .live/<name>.json holding {"url": "<the page URL, with variant parameters>"},\n' +
      'so extraction sees the canonical URL and anything that selects a variant.\n\n' +
      'Optionally add .live/<name>.truth.json with the values you read off the page —\n' +
      '  { "price": "23.96", "original": null, "variant": { "Color": "Rumble Crumble" } }\n' +
      'so a confidently-wrong value is caught rather than scored as a win.\n\n' +
      'Do not use Cmd+S — it saves the HTML the server sent, not the DOM after hydration,\n' +
      'which is not what the extension reads.',
  );
  process.exit(1);
}

const rows = files.sort().map(scorePage);

if (args.save) {
  writeFileSync(resolve(repoRoot, args.save), JSON.stringify(rows, null, 2));
  console.error(`baseline written to ${args.save}`);
}

if (args.json) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const baseline = args.baseline
    ? JSON.parse(readFileSync(resolve(repoRoot, args.baseline), 'utf8'))
    : null;
  report(rows, baseline);
}
