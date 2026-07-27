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

    return {
      name,
      url,
      domain: capture.source.domain,
      extractor: `${capture.extraction.extractorId}@${capture.extraction.extractorVersion}`,
      confidence: Number(capture.extraction.overallConfidence.toFixed(3)),
      fields,
    };
  } catch (error) {
    return { name, url, error: error instanceof Error ? error.message : String(error) };
  }
}

function mark(value) {
  return value === null || value === undefined ? '·' : '✓';
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
    '.live/ holds no .html pages yet.\n' +
      'Save a product page from Chrome (Cmd+S -> "Webpage, HTML only") into .live/,\n' +
      'and add .live/<name>.json with {"url": "<the page URL>"} so extraction sees the\n' +
      'canonical URL and any variant parameters.',
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
