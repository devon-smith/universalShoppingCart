import type { ExtractionResult } from '@universal-cart/extractors';

/**
 * Messages between the side panel and the injected capture script.
 *
 * Versioned like every other cross-boundary payload (BUILD_PLAN.md §5.1): an old injected
 * script left over on a page after an extension update must be recognised as incompatible
 * rather than half-understood.
 *
 * Nothing here can carry page HTML, cookies, or tokens — the only payload is an
 * `ExtractionResult`, whose shape is fixed by the capture contract.
 */

export const MESSAGE_SCHEMA_VERSION = 1 as const;

export const EXTRACT_REQUEST = 'universal-cart/extract-request' as const;
export const EXTRACT_RESPONSE = 'universal-cart/extract-response' as const;

export interface ExtractRequest {
  schemaVersion: typeof MESSAGE_SCHEMA_VERSION;
  type: typeof EXTRACT_REQUEST;
  requestId: string;
}

export interface ExtractResponse {
  schemaVersion: typeof MESSAGE_SCHEMA_VERSION;
  type: typeof EXTRACT_RESPONSE;
  requestId: string;
  result: ExtractionResult;
}

export function extractRequest(requestId: string): ExtractRequest {
  return { schemaVersion: MESSAGE_SCHEMA_VERSION, type: EXTRACT_REQUEST, requestId };
}

export function isExtractRequest(value: unknown): value is ExtractRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<ExtractRequest>;
  return (
    message.schemaVersion === MESSAGE_SCHEMA_VERSION &&
    message.type === EXTRACT_REQUEST &&
    typeof message.requestId === 'string' &&
    message.requestId.length > 0
  );
}

export function isExtractResponse(value: unknown, requestId: string): value is ExtractResponse {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<ExtractResponse>;
  return (
    message.schemaVersion === MESSAGE_SCHEMA_VERSION &&
    message.type === EXTRACT_RESPONSE &&
    message.requestId === requestId &&
    typeof message.result === 'object' &&
    message.result !== null
  );
}
