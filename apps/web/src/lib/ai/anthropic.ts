import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

/**
 * Server-only access to the Claude API (BUILD_PLAN.md §16.2).
 *
 * The provider key never leaves the server: this module imports `server-only`, so any attempt
 * to pull it into a client bundle is a build error, and the key is read from `AI_PROVIDER_API_KEY`
 * — a name with no `NEXT_PUBLIC_` prefix, so Next.js will not inline it into client code. The
 * extension never touches this path at all; AI runs behind the web server.
 */

/**
 * Thrown when the AI feature is asked for but no provider key is configured. Callers catch this
 * to degrade gracefully — the compare view shows a "summaries aren't enabled" state rather than
 * an error — instead of surfacing a stack trace or, worse, pretending the key exists.
 */
export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI comparison summaries are not configured (AI_PROVIDER_API_KEY is unset).');
    this.name = 'AiNotConfiguredError';
  }
}

/** True when a provider key is present, without constructing a client or revealing the key. */
export function isAiConfigured(): boolean {
  return (
    typeof process.env.AI_PROVIDER_API_KEY === 'string' &&
    process.env.AI_PROVIDER_API_KEY.length > 0
  );
}

/**
 * Build a Claude client, or throw {@link AiNotConfiguredError} when the key is unset.
 *
 * Read at call time, not module load, so an unconfigured deploy imports this file harmlessly and
 * only the actual summarize path fails — and fails with a typed error the UI already handles.
 */
export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.AI_PROVIDER_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  return new Anthropic({ apiKey });
}
