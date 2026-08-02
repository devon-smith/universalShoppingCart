/**
 * Extractor health (BUILD_PLAN.md §19.2).
 *
 * Answers one question: which domains is extraction working badly on, and which extractor
 * version was responsible. Everything here is derived from columns already stored on
 * `items` — no new telemetry, and nothing that could carry a note, a title, or a URL.
 *
 * What a row may contain is deliberately narrow: a domain, an extractor id and version, a
 * confidence, and booleans for whether each field came back. A domain is not a URL —
 * `shop.example` says which retailer's markup needs attention; `shop.example/p/gift-for-…`
 * would say what someone is buying (BUILD_PLAN.md §19.1).
 */

export interface DiagnosticItem {
  domain: string;
  extractor_id: string | null;
  extractor_version: string | null;
  extraction_confidence: number | null;
  title: string | null;
  current_price: string | number | null;
  currency: string | null;
  image_url: string | null;
  availability: string;
  selected_variant: Record<string, string> | null;
  identifiers: Record<string, string> | null;
  last_observed_at: string | null;
}

/** The fields whose presence says whether extraction did its job. */
export const TRACKED_FIELDS = [
  'title',
  'price',
  'currency',
  'image',
  'availability',
  'variant',
  'identifier',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

export function fieldPresence(item: DiagnosticItem): Record<TrackedField, boolean> {
  return {
    title: item.title !== null && item.title.trim().length > 0,
    price: item.current_price !== null,
    currency: item.currency !== null,
    image: item.image_url !== null,
    availability: item.availability !== 'unknown',
    variant: Object.keys(item.selected_variant ?? {}).length > 0,
    identifier: Object.keys(item.identifiers ?? {}).length > 0,
  };
}

/**
 * How an extraction went wrong, in one word.
 *
 * Only one class is reported per item, worst first — a capture with no price and low
 * confidence is a `no_price` problem, and saying so twice would not help anyone.
 */
export type FailureClass =
  'ok' | 'no_price' | 'no_currency' | 'low_confidence' | 'generic_fallback';

/** Below this, the capture is a guess the user was asked to confirm. */
export const LOW_CONFIDENCE = 0.6;

/** The extractor id the pipeline records when no adapter contributed anything. */
export const GENERIC_EXTRACTOR_ID = 'generic';

export function failureClass(item: DiagnosticItem): FailureClass {
  if (item.current_price === null) return 'no_price';
  if (item.currency === null) return 'no_currency';
  if (item.extraction_confidence !== null && item.extraction_confidence < LOW_CONFIDENCE) {
    return 'low_confidence';
  }
  // Not a failure on its own — most of the web is not one of the five platforms — but it
  // is the signal to look at when a domain that *should* have an adapter does not.
  if (item.extractor_id === null || item.extractor_id === GENERIC_EXTRACTOR_ID) {
    return 'generic_fallback';
  }
  return 'ok';
}

export const FAILURE_CLASS_LABELS: Record<FailureClass, string> = {
  ok: 'Complete',
  no_price: 'No price',
  no_currency: 'No currency',
  low_confidence: 'Low confidence',
  generic_fallback: 'Generic fallback',
};

export interface DomainHealth {
  domain: string;
  /** Every extractor id/version pair seen on this domain, most-used first. */
  extractors: Array<{ id: string; version: string; count: number }>;
  items: number;
  /** Mean of the stored confidences, or `null` when none were recorded. */
  meanConfidence: number | null;
  /** Share of items where each field came back, 0–1. */
  presence: Record<TrackedField, number>;
  classes: Record<FailureClass, number>;
  lastObservedAt: string | null;
}

/**
 * Group items by domain.
 *
 * Sorted worst first: a domain where extraction is failing is what this page exists to
 * surface, so it should not be below the fold behind twenty healthy ones.
 */
export function summarizeByDomain(items: DiagnosticItem[]): DomainHealth[] {
  const byDomain = new Map<string, DiagnosticItem[]>();
  for (const item of items) {
    const list = byDomain.get(item.domain);
    if (list) list.push(item);
    else byDomain.set(item.domain, [item]);
  }

  const summaries = [...byDomain.entries()].map(([domain, group]) => {
    const confidences = group
      .map((item) => item.extraction_confidence)
      .filter((value): value is number => value !== null);

    const presence = {} as Record<TrackedField, number>;
    for (const field of TRACKED_FIELDS) {
      const present = group.filter((item) => fieldPresence(item)[field]).length;
      presence[field] = group.length === 0 ? 0 : present / group.length;
    }

    const classes: Record<FailureClass, number> = {
      ok: 0,
      no_price: 0,
      no_currency: 0,
      low_confidence: 0,
      generic_fallback: 0,
    };
    for (const item of group) classes[failureClass(item)] += 1;

    const extractorCounts = new Map<string, number>();
    for (const item of group) {
      const key = `${item.extractor_id ?? 'unknown'}@${item.extractor_version ?? 'unknown'}`;
      extractorCounts.set(key, (extractorCounts.get(key) ?? 0) + 1);
    }

    const observed = group
      .map((item) => item.last_observed_at)
      .filter((value): value is string => value !== null)
      .sort();

    return {
      domain,
      items: group.length,
      meanConfidence:
        confidences.length === 0
          ? null
          : confidences.reduce((total, value) => total + value, 0) / confidences.length,
      presence,
      classes,
      extractors: [...extractorCounts.entries()]
        .map(([key, count]) => {
          const at = key.lastIndexOf('@');
          return { id: key.slice(0, at), version: key.slice(at + 1), count };
        })
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
      lastObservedAt: observed.at(-1) ?? null,
    };
  });

  return summaries.sort(
    (a, b) =>
      healthScore(a) - healthScore(b) || b.items - a.items || a.domain.localeCompare(b.domain),
  );
}

/** Share of a domain's items that came back complete. Lower is worse, so lower sorts first. */
export function healthScore(summary: DomainHealth): number {
  return summary.items === 0 ? 1 : summary.classes.ok / summary.items;
}
