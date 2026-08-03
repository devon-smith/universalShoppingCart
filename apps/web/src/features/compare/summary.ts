/**
 * Phase 8 — the fact-grounded comparison summary, prompt side.
 *
 * This module is pure: it turns a {@link Comparison} into (a) a compact facts object and
 * (b) the exact messages sent to the model, plus the schema its answer must satisfy. No
 * network, no key, no React — so the grounding rules can be unit-tested without a live call.
 *
 * The whole point of Phase 8 is a summary that invents nothing (CLAUDE.md; BUILD_PLAN.md
 * §16.2). Two things enforce that here, before the model is even asked:
 *
 * 1. **Only stored facts are sent.** The input is the already-computed `Comparison`, which is
 *    itself built from stored item fields — never page HTML, cookies, or notes-as-instructions.
 *    We forward the grounded rows and drop nothing silently.
 *
 * 2. **Missing data is named, not hidden.** For every field an item lacks, we emit an explicit
 *    entry in `missing`, and the prompt tells the model to surface gaps rather than paper over
 *    them. "We don't know the composition of item B" is the honest output §16.2 demands.
 *
 * What is *not* asserted is as important as what is. Per `compare.ts`, variant options
 * (size, colour), composition, and notes are descriptive, never "the same across items" — so
 * they are passed as per-item descriptors the model may mention, never as agreements it may
 * claim. The model is told this in the system prompt.
 */

import { z } from 'zod';

import type { Comparison, CompareRow } from './compare';

/**
 * Bump when the prompt, schema, or fact-shaping changes in a way that should invalidate a
 * stored summary. It is recorded with every generated summary (provenance, §16.2) and is part
 * of the cache key, so a prompt change regenerates rather than serving a stale answer.
 */
export const SUMMARY_PROMPT_VERSION = '2026-08-03.1';

/** The model this feature is pinned to. Recorded as provenance and part of the cache key. */
export const SUMMARY_MODEL = 'claude-opus-5';

/** One item, reduced to the identity the summary refers to it by. */
export interface SummaryFactItem {
  id: string;
  /** 1-based label ("Item 1") so the model can reference items without echoing a uuid. */
  ref: string;
  title: string;
}

/**
 * A single grounded fact drawn from one comparison row.
 *
 * `values` is one entry per item, in item order, with `null` for an item that lacks the
 * field — the model is given the gap, not left to guess it. `comparable` mirrors the row:
 * true only where cross-item agreement means something (price, availability, retailer), so
 * the model is never invited to say two garments are "the same size".
 */
export interface SummaryFact {
  key: string;
  label: string;
  comparable: boolean;
  values: (string | null)[];
}

/** What the whole summary is grounded in: the items, the facts, and the named gaps. */
export interface ComparisonFacts {
  items: SummaryFactItem[];
  facts: SummaryFact[];
  /** Human-readable "Item 2 has no listed price" lines, one per (item, missing field). */
  missing: string[];
  /** True when the set spans currencies, so no cheapest exists (carried from the Comparison). */
  mixedCurrency: boolean;
}

/**
 * The rows worth summarizing. Image rows carry no comparable fact, and the price-change /
 * original-price rows are derived views the model does not need for a purchase-oriented
 * summary. Everything else — price, availability, retailer, brand, variants, composition,
 * notes, target — is grounded and forwarded.
 */
const OMITTED_ROW_KINDS = new Set(['image']);
const OMITTED_ROW_KEYS = new Set(['original', 'price-change']);

/** The plain text a row's cell offers the model — its `text`, never a re-derived value. */
function cellText(row: CompareRow, index: number): string | null {
  const value = row.cells[index]?.text ?? null;
  return value === '' ? null : value;
}

/**
 * Reduce a {@link Comparison} to the grounded facts a summary may use.
 *
 * Pure and total: given the same comparison it always yields the same facts, which is what
 * lets the summary be cached by a fingerprint of them. Missing values become explicit
 * `missing` lines rather than absent facts, so the model is handed the gaps.
 */
export function buildComparisonFacts(comparison: Comparison): ComparisonFacts {
  const items: SummaryFactItem[] = comparison.items.map((item, i) => ({
    id: item.id,
    ref: `Item ${i + 1}`,
    title: item.title,
  }));

  const facts: SummaryFact[] = [];
  const missing: string[] = [];

  for (const row of comparison.rows) {
    if (OMITTED_ROW_KINDS.has(row.kind) || OMITTED_ROW_KEYS.has(row.key)) continue;

    const values = items.map((_, i) => cellText(row, i));

    // A row every item leaves blank carries no fact; skip it rather than emit an empty row.
    if (values.every((v) => v === null)) continue;

    facts.push({ key: row.key, label: row.label, comparable: row.comparable, values });

    // Name every gap in a row at least one item populates: "Item 3 has no listed <field>".
    values.forEach((value, i) => {
      if (value === null) {
        missing.push(`${items[i]!.ref} has no listed ${row.label.toLowerCase()}.`);
      }
    });
  }

  return { items, facts, missing, mixedCurrency: comparison.mixedCurrency };
}

/**
 * A deterministic fingerprint of the facts a summary is grounded in, plus the model and
 * prompt version. Two comparisons with identical facts share a fingerprint and therefore a
 * cached summary; a prompt-version bump changes it, forcing regeneration. Order-stable: item
 * refs and row keys already come out in a fixed order, so the string is reproducible.
 *
 * This is a cache key, not a security boundary — RLS on `comparison_summaries` is that. So a
 * plain string is hashed by the caller (or the DB); we only need it stable and collision-safe
 * for distinct fact sets.
 */
export function factsFingerprintInput(facts: ComparisonFacts): string {
  const parts = [
    `v=${SUMMARY_PROMPT_VERSION}`,
    `m=${SUMMARY_MODEL}`,
    `mixed=${facts.mixedCurrency ? 1 : 0}`,
    ...facts.items.map((it) => `item=${it.id}:${it.title}`),
    ...facts.facts.map((f) => `${f.key}=${f.values.map((v) => v ?? '∅').join('|')}`),
  ];
  return parts.join('\n');
}

/**
 * The structured answer the model must return. Constraining the shape does two things: it
 * keeps the summary renderable without parsing prose, and it gives the orchestrator a place
 * to reject a fabricated item reference (every `itemRefs` entry must be a real ref).
 *
 * - `overview` — a short, plain paragraph. No markdown, no headings.
 * - `points` — the substantive comparisons, each optionally scoped to the items it concerns.
 * - `missingData` — gaps the summary could not fill, echoed from the facts. Required to be
 *   present (possibly empty) so "identifies missing data" is a structural guarantee, not a
 *   hope (§16.2; Phase 8 acceptance).
 */
export const summarySchema = z.object({
  overview: z.string().min(1).max(600),
  points: z
    .array(
      z.object({
        text: z.string().min(1).max(400),
        itemRefs: z.array(z.string()).max(4).default([]),
      }),
    )
    .max(6),
  missingData: z.array(z.string().max(200)).max(12),
});

export type ComparisonSummary = z.infer<typeof summarySchema>;

const SYSTEM_PROMPT = [
  'You compare 2–4 clothing products a shopper has saved, using ONLY the facts you are given.',
  'You are grounding a purchase decision, so accuracy matters more than fluency.',
  '',
  'Hard rules:',
  '- Use only the provided facts. Never invent a price, material, size, brand, or availability.',
  '- If a fact is missing for an item, say so plainly. Do not guess or fill it in.',
  '- A row marked non-comparable (variants like size/colour, composition, notes) describes each',
  '  item individually. Never claim two items "match" or are "the same" on a non-comparable row —',
  "  one retailer's M is not another's M, and identical fibre text is not a confirmed match.",
  '- Only call an item the cheapest when a single price is genuinely lowest in one currency.',
  '  If the set mixes currencies, do not rank prices at all.',
  '- Refer to items by their given label (e.g. "Item 1"), never by inventing a name.',
  '- Be concise: a short overview and a few concrete points a shopper can act on.',
  '- Return every gap you noticed in missingData, even ones you mention in the overview.',
].join('\n');

/** The user message: the facts, serialized plainly. Deterministic for a given facts object. */
function renderFacts(facts: ComparisonFacts): string {
  const lines: string[] = [];

  lines.push('Items being compared:');
  for (const item of facts.items) {
    lines.push(`- ${item.ref}: ${item.title}`);
  }

  if (facts.mixedCurrency) {
    lines.push('', 'Note: these items are priced in different currencies; do not rank prices.');
  }

  lines.push('', 'Facts (one row per attribute; values are per item, in order):');
  for (const fact of facts.facts) {
    const rendered = facts.items
      .map((item, i) => `${item.ref}=${fact.values[i] ?? '(missing)'}`)
      .join('; ');
    const tag = fact.comparable ? 'comparable' : 'descriptive, do not claim agreement';
    lines.push(`- ${fact.label} [${tag}]: ${rendered}`);
  }

  if (facts.missing.length > 0) {
    lines.push('', 'Known gaps:');
    for (const gap of facts.missing) lines.push(`- ${gap}`);
  }

  return lines.join('\n');
}

/** The messages for one summary request: a fixed system prompt and the rendered facts. */
export function buildSummaryMessages(facts: ComparisonFacts): {
  system: string;
  user: string;
} {
  return { system: SYSTEM_PROMPT, user: renderFacts(facts) };
}

/** The set of valid item references, for rejecting any the model invents. */
export function validItemRefs(facts: ComparisonFacts): Set<string> {
  return new Set(facts.items.map((item) => item.ref));
}
