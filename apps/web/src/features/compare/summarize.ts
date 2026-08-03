/**
 * Phase 8 — the fact-grounded comparison summary, orchestration side.
 *
 * `summary.ts` builds the prompt and schema; this turns them into a validated summary. It is
 * deliberately split from the SDK call: the model call is injected, so every guardrail around
 * it — schema validation, refusal handling, rejecting an item reference the model invents — is
 * unit-tested without a live key. The real Claude wrapper lives in `claude-call.ts`.
 *
 * Guardrails enforced here (CLAUDE.md; BUILD_PLAN.md §16.2):
 * - A `refusal` stop reason is handled before any content is read, and surfaces as a typed
 *   error the UI can show — never a half-summary.
 * - The answer must satisfy `summarySchema`; anything else is rejected, not best-guessed.
 * - Every `itemRefs` entry must be a real item reference. A reference to an item that is not in
 *   the set is a fabrication signal, so the whole summary is rejected rather than rendered.
 */

import type { Comparison } from './compare';
import type { ComparisonFacts, ComparisonSummary } from './summary';
import {
  buildComparisonFacts,
  buildSummaryMessages,
  summarySchema,
  SUMMARY_MODEL,
  SUMMARY_PROMPT_VERSION,
  validItemRefs,
} from './summary';

/** Thrown when the model declines to answer (`stop_reason: "refusal"`). */
export class AiSummaryRefusedError extends Error {
  constructor() {
    super('The model declined to summarize this comparison.');
    this.name = 'AiSummaryRefusedError';
  }
}

/** Thrown when the answer is unparseable or references an item that does not exist. */
export class AiSummaryInvalidError extends Error {
  constructor(reason: string) {
    super(`The model returned an unusable summary: ${reason}`);
    this.name = 'AiSummaryInvalidError';
  }
}

/**
 * The raw outcome of one model call, before this module validates it.
 *
 * `refused` is read first, exactly as the SDK guidance requires: on a refusal there is no
 * content to parse. Otherwise `content` is the model's JSON object (already the SDK's parsed
 * value, or a plain object) which we validate against the schema ourselves.
 */
export interface SummaryModelResult {
  refused: boolean;
  /** The model's structured answer, unvalidated. Ignored when `refused` is true. */
  content: unknown;
  /** The model id that actually answered, for provenance. */
  model: string;
}

/** The injected call to the model. The real one wraps the Anthropic SDK; tests fake it. */
export type SummaryModelCall = (messages: {
  system: string;
  user: string;
}) => Promise<SummaryModelResult>;

/** A validated summary plus the provenance that must be stored with it (§16.2). */
export interface GeneratedSummary {
  summary: ComparisonSummary;
  model: string;
  promptVersion: string;
  facts: ComparisonFacts;
}

/**
 * Generate a grounded summary for a comparison.
 *
 * Builds the facts, calls the (injected) model, and validates the result through every
 * guardrail before returning it with provenance. Throws {@link AiSummaryRefusedError} or
 * {@link AiSummaryInvalidError} rather than returning a summary that fails a guardrail.
 */
export async function generateComparisonSummary(
  comparison: Comparison,
  call: SummaryModelCall,
): Promise<GeneratedSummary> {
  const facts = buildComparisonFacts(comparison);
  const messages = buildSummaryMessages(facts);

  const result = await call(messages);

  // Refusal is checked first: on a refusal there is no content worth reading.
  if (result.refused) throw new AiSummaryRefusedError();

  const parsed = summarySchema.safeParse(result.content);
  if (!parsed.success) {
    throw new AiSummaryInvalidError(parsed.error.issues[0]?.message ?? 'did not match the schema');
  }

  // Any item reference the model uses must be one we handed it. An unknown ref means the model
  // invented an item — exactly the fabrication Phase 8 must not surface — so reject the whole
  // summary rather than quietly dropping the bad reference.
  const allowed = validItemRefs(facts);
  for (const point of parsed.data.points) {
    for (const ref of point.itemRefs) {
      if (!allowed.has(ref)) {
        throw new AiSummaryInvalidError(`referenced an unknown item "${ref}"`);
      }
    }
  }

  return {
    summary: parsed.data,
    model: result.model,
    promptVersion: SUMMARY_PROMPT_VERSION,
    facts,
  };
}

export { SUMMARY_MODEL, SUMMARY_PROMPT_VERSION };
