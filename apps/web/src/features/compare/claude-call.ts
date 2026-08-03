import 'server-only';

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { createAnthropicClient } from '@/lib/ai/anthropic';

import { summarySchema } from './summary';
import type { SummaryModelCall } from './summarize';
import { SUMMARY_MODEL } from './summarize';

/**
 * The real Claude call behind {@link generateComparisonSummary}'s injected `call`.
 *
 * Kept in its own server-only module so the orchestrator (and its guardrail tests) never import
 * the SDK. Everything provider-specific — the model id, structured output, thinking, refusal
 * detection — lives here; the orchestrator only sees the small {@link SummaryModelResult} shape.
 *
 * The answer is constrained to `summarySchema` via `zodOutputFormat`, so the model returns JSON
 * matching the schema rather than prose to parse. A refusal is reported as `refused: true`
 * without reading content, exactly as the SDK guidance requires.
 */
export function createClaudeSummaryCall(): SummaryModelCall {
  const client = createAnthropicClient();

  return async ({ system, user }) => {
    const response = await client.messages.parse({
      model: SUMMARY_MODEL,
      max_tokens: 4096,
      // Opus 5 runs adaptive thinking by default; naming it keeps the intent explicit and the
      // module portable if the default ever changes. `budget_tokens` is rejected on this model.
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: zodOutputFormat(summarySchema) },
    });

    // Refusal first: on a refusal there is no structured answer to trust.
    if (response.stop_reason === 'refusal') {
      return { refused: true, content: null, model: response.model };
    }

    // `parsed_output` is null when the model's JSON did not satisfy the schema; pass it through
    // and let the orchestrator reject it uniformly (it re-validates against the same schema).
    return { refused: false, content: response.parsed_output, model: response.model };
  };
}
