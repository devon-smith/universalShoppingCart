import {
  runRefreshCycle,
  safeFetch,
  type ObservedAvailability,
  type RefreshJob,
} from '@universal-cart/refresh';
import { NextResponse } from 'next/server';

import { parseObservation } from '@/lib/refresh/parse';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * The background-refresh worker (BUILD_PLAN.md §14.2), invoked by Supabase Cron.
 *
 * It runs on the Node runtime, not the Edge runtime, so `safeFetch` (which resolves DNS to check
 * for private addresses) and the extractor pipeline over a server DOM behave exactly as they do
 * under test. It is authorised solely by the shared `CRON_SECRET` bearer — there is no user
 * session — and everything it does goes through the service-role RPCs, which own the rules.
 *
 * The RunBook documents the `cron.schedule` call that points here (docs/RUNBOOK.md).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DueRow {
  item_id: string;
  source_url: string;
  availability: ObservedAvailability;
  current_price: string | null;
  desired_price: string | null;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Everything the worker touches goes through a SECURITY DEFINER RPC — service_role has no table
  // privileges, so the selector returns the item fields inline rather than the worker reading
  // `items` directly (which it cannot).
  async function selectDueJobs(limit: number): Promise<RefreshJob[]> {
    const { data, error } = await supabase.rpc('select_due_refresh_jobs', { p_limit: limit });
    if (error) throw new Error(error.message);

    return ((data ?? []) as unknown as DueRow[]).map((row) => ({
      itemId: row.item_id,
      url: row.source_url,
      previous: {
        availability: row.availability,
        price: row.current_price,
        desiredPrice: row.desired_price,
      },
    }));
  }

  const summary = await runRefreshCycle({
    selectDueJobs,
    fetchHtml: async (url) => (await safeFetch(url)).body,
    parse: parseObservation,
    recordObservation: async (itemId, observation) => {
      const { data, error } = await supabase.rpc('record_background_observation', {
        p_item_id: itemId,
        p_price: observation.price ?? undefined,
        p_original_price: observation.originalPrice ?? undefined,
        p_currency: observation.currency ?? undefined,
        p_availability: observation.availability,
        p_extractor_id: observation.extractorId ?? undefined,
        p_extractor_version: observation.extractorVersion ?? undefined,
        p_confidence: observation.confidence ?? undefined,
      });
      if (error) throw new Error(error.message);
      return Boolean((data as { observationInserted?: boolean } | null)?.observationInserted);
    },
    recordNotification: async (itemId, type, observedValue, currency) => {
      const { error } = await supabase.rpc('record_notification', {
        p_item_id: itemId,
        p_type: type,
        p_observed_value: observedValue ?? undefined,
        p_currency: currency ?? undefined,
      });
      if (error) throw new Error(error.message);
    },
    recordResult: async (itemId, ok) => {
      const { error } = await supabase.rpc('record_refresh_result', {
        p_item_id: itemId,
        p_ok: ok,
      });
      if (error) throw new Error(error.message);
    },
  });

  return NextResponse.json(summary);
}
