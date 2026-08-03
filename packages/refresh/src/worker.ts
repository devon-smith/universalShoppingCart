import {
  evaluateAlerts,
  type AlertType,
  type ObservedAvailability,
  type ObservedState,
} from './alerts';

/**
 * The background-refresh worker's orchestration (BUILD_PLAN.md §14.2).
 *
 * One due job → fetch the page → parse an observation → record it → raise any alerts the
 * transition warrants → record the outcome for backoff. All I/O is injected, so this decision
 * flow is unit-tested without a network, a DOM, or a database — the same shape as `safeFetch`.
 * The real implementations (the SSRF fetch, a server DOM + the extractor pipeline, the
 * service-role RPCs) are wired in the web route and exercised live by the local host.
 *
 * A job that yields no usable price is a *failed* refresh (it feeds backoff), not a null
 * observation — the worker never records "the price became unknown" from a parse that simply
 * did not find one.
 */

export interface RefreshJob {
  itemId: string;
  url: string;
  /** The item's observed state before this refresh, for alert-transition comparison. */
  previous: ObservedState;
}

export interface ParsedObservation {
  price: string | null;
  originalPrice: string | null;
  currency: string | null;
  availability: ObservedAvailability;
  extractorId: string | null;
  extractorVersion: string | null;
  confidence: number | null;
}

export interface RefreshWorkerDeps {
  /** Fetch a URL's HTML under the SSRF rules; throws on any failure. */
  fetchHtml: (url: string) => Promise<string>;
  /** Parse fetched HTML into observed fields, or null when it holds no usable product data. */
  parse: (html: string, url: string) => ParsedObservation | null;
  /** Record the observation (record_background_observation); returns whether a row was inserted. */
  recordObservation: (itemId: string, observation: ParsedObservation) => Promise<boolean>;
  /** Record a fired alert (record_notification). */
  recordNotification: (
    itemId: string,
    type: AlertType,
    observedValue: string | null,
    currency: string | null,
  ) => Promise<void>;
  /** Record the outcome for backoff (record_refresh_result). */
  recordResult: (itemId: string, ok: boolean) => Promise<void>;
}

export type JobOutcome =
  | { itemId: string; ok: true; observationInserted: boolean; alerts: AlertType[] }
  | { itemId: string; ok: false; reason: string };

function reasonOf(error: unknown): string {
  if (error && typeof error === 'object' && 'reason' in error && typeof error.reason === 'string') {
    return error.reason;
  }
  return error instanceof Error ? error.message : 'error';
}

/** Process one job. Any failure is recorded as an unsuccessful refresh so the schedule backs off. */
export async function processRefreshJob(
  job: RefreshJob,
  deps: RefreshWorkerDeps,
): Promise<JobOutcome> {
  try {
    const html = await deps.fetchHtml(job.url);
    const parsed = deps.parse(html, job.url);

    if (parsed === null || parsed.price === null) {
      await deps.recordResult(job.itemId, false);
      return { itemId: job.itemId, ok: false, reason: parsed === null ? 'unparsable' : 'no_price' };
    }

    const observationInserted = await deps.recordObservation(job.itemId, parsed);

    const current: ObservedState = {
      availability: parsed.availability,
      price: parsed.price,
      // Desired price is user-authored and unchanged by a refresh.
      desiredPrice: job.previous.desiredPrice,
    };
    const alerts = evaluateAlerts(job.previous, current);
    for (const type of alerts) {
      const value = type === 'price_below_desired' ? parsed.price : parsed.availability;
      await deps.recordNotification(job.itemId, type, value, parsed.currency);
    }

    await deps.recordResult(job.itemId, true);
    return { itemId: job.itemId, ok: true, observationInserted, alerts };
  } catch (error) {
    await deps.recordResult(job.itemId, false);
    return { itemId: job.itemId, ok: false, reason: reasonOf(error) };
  }
}

export interface RefreshCycleDeps extends RefreshWorkerDeps {
  /** Claim up to `limit` due jobs (select_due_refresh_jobs + the items they point at). */
  selectDueJobs: (limit: number) => Promise<RefreshJob[]>;
}

export interface RefreshCycleSummary {
  processed: number;
  ok: number;
  failed: number;
  outcomes: JobOutcome[];
}

/**
 * Run one refresh cycle: claim the due jobs and process them one at a time. Sequential on
 * purpose — it is gentle on the retailers being fetched, and the schedule's backoff, not
 * throughput, is what governs load.
 */
export async function runRefreshCycle(
  deps: RefreshCycleDeps,
  options: { limit?: number } = {},
): Promise<RefreshCycleSummary> {
  const jobs = await deps.selectDueJobs(options.limit ?? 25);
  const outcomes: JobOutcome[] = [];
  for (const job of jobs) {
    outcomes.push(await processRefreshJob(job, deps));
  }
  const ok = outcomes.filter((outcome) => outcome.ok).length;
  return { processed: outcomes.length, ok, failed: outcomes.length - ok, outcomes };
}
