import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { adapterDescriptors } from '@universal-cart/extractors';

import type { DiagnosticItem } from '@/features/diagnostics/health';
import {
  FAILURE_CLASS_LABELS,
  summarizeByDomain,
  TRACKED_FIELDS,
} from '@/features/diagnostics/health';
import { createServerSupabase } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Extractor health · Universal Cart',
};

export const dynamic = 'force-dynamic';

/**
 * Extractor health (BUILD_PLAN.md §19.2).
 *
 * Which retailers extraction is working badly on, and which adapter version was
 * responsible. Scoped to the signed-in user by Row Level Security, which is also what
 * makes "internal" true: there is no cross-user view here to leak, because the query
 * cannot see another user's rows.
 *
 * Deliberately no titles, no notes, and no URLs — a domain names a retailer's markup,
 * while a product URL names what somebody is buying (BUILD_PLAN.md §19.1).
 */
const DIAGNOSTIC_COLUMNS =
  'domain, extractor_id, extractor_version, extraction_confidence, title, current_price::text, currency, image_url, availability, selected_variant, identifiers, last_observed_at';

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export default async function DiagnosticsPage() {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=%2Fapp%2Fdiagnostics');
  }

  const { data, error } = await supabase
    .from('items')
    .select(DIAGNOSTIC_COLUMNS)
    .neq('status', 'archived');

  const summaries = summarizeByDomain((data ?? []) as unknown as DiagnosticItem[]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-1">
        <Link href="/app" className="text-sm text-[var(--color-ink-muted)] hover:underline">
          ← Back to your carts
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Extractor health</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          How well extraction is working on the retailers you save from. Domains only — no product
          titles, notes, or page URLs appear on this page.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-800">
          {error.message}
        </p>
      ) : null}

      <section aria-labelledby="registry-heading" className="flex flex-col gap-3">
        <h2 id="registry-heading" className="text-sm font-semibold">
          Adapters in this build
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-md border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left">
                <th className="py-2 pr-4 font-medium">Adapter</th>
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {adapterDescriptors().map((adapter) => (
                <tr key={adapter.id} className="border-b border-[var(--color-line)]">
                  <td className="py-2 pr-4 font-mono text-xs">{adapter.id}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{adapter.version}</td>
                  <td className="py-2 font-mono text-xs">{adapter.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Every adapter is bundled with the extension. Nothing is downloaded or evaluated at
          runtime.
        </p>
      </section>

      <section aria-labelledby="domains-heading" className="flex flex-col gap-3">
        <h2 id="domains-heading" className="text-sm font-semibold">
          By retailer domain
        </h2>

        {summaries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--color-line)] px-4 py-6 text-sm text-[var(--color-ink-muted)]">
            Nothing saved yet, so there is nothing to diagnose.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="domain-health-list">
            {summaries.map((summary) => (
              <li
                key={summary.domain}
                data-testid="domain-health"
                data-domain={summary.domain}
                className="flex flex-col gap-2 rounded-lg border border-[var(--color-line)] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-sm">{summary.domain}</span>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {summary.items} item{summary.items === 1 ? '' : 's'} ·{' '}
                    {summary.meanConfidence === null
                      ? 'no confidence recorded'
                      : `mean confidence ${summary.meanConfidence.toFixed(2)}`}
                  </span>
                </div>

                <p className="flex flex-wrap gap-1.5 text-xs">
                  {summary.extractors.map((extractor) => (
                    <span
                      key={`${extractor.id}@${extractor.version}`}
                      data-testid="extractor-badge"
                      className="rounded-full border border-[var(--color-line)] px-2 py-0.5 font-mono"
                    >
                      {extractor.id}@{extractor.version} ×{extractor.count}
                    </span>
                  ))}
                </p>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
                  {TRACKED_FIELDS.map((field) => (
                    <div key={field} className="flex justify-between gap-2">
                      <dt className="text-[var(--color-ink-muted)]">{field}</dt>
                      <dd
                        data-testid={`presence-${field}`}
                        className={
                          summary.presence[field] < 1
                            ? 'text-amber-700 dark:text-amber-400'
                            : undefined
                        }
                      >
                        {percent(summary.presence[field])}
                      </dd>
                    </div>
                  ))}
                </dl>

                <p className="flex flex-wrap gap-1.5 text-xs">
                  {(
                    Object.entries(summary.classes) as Array<
                      [keyof typeof FAILURE_CLASS_LABELS, number]
                    >
                  )
                    .filter(([, count]) => count > 0)
                    .map(([failure, count]) => (
                      <span
                        key={failure}
                        data-testid="failure-class"
                        data-class={failure}
                        className={[
                          'rounded-full px-2 py-0.5',
                          failure === 'ok'
                            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
                        ].join(' ')}
                      >
                        {FAILURE_CLASS_LABELS[failure]}: {count}
                      </span>
                    ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
