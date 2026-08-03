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

interface DueJobRow {
  item_id: string;
}

interface ItemRow {
  id: string;
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

  async function selectDueJobs(limit: number): Promise<RefreshJob[]> {
    const { data, error } = await supabase.rpc('select_due_refresh_jobs', { p_limit: limit });
    if (error) throw new Error(error.message);

    const jobRows = (data ?? []) as unknown as DueJobRow[];
    if (jobRows.length === 0) return [];

    const ids = jobRows.map((row) => row.item_id);
    const { data: items, error: itemsError } = await supabase
      .from('items')
      // Money as text so PostgREST does not round the exact decimal into a JSON double.
      .select('id, source_url, availability, current_price::text, desired_price::text')
      .in('id', ids);
    if (itemsError) throw new Error(itemsError.message);

    const byId = new Map((items as unknown as ItemRow[]).map((item) => [item.id, item]));
    // Preserve the due order; drop any item that vanished between the two reads.
    return jobRows
      .map((row) => byId.get(row.item_id))
      .filter((item): item is ItemRow => item !== undefined)
      .map((item) => ({
        itemId: item.id,
        url: item.source_url,
        previous: {
          availability: item.availability,
          price: item.current_price,
          desiredPrice: item.desired_price,
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
