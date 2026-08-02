import { describe, expect, it } from 'vitest';

import {
  EXTRACT_REQUEST,
  EXTRACT_RESPONSE,
  extractRequest,
  isExtractRequest,
  isExtractResponse,
  MESSAGE_SCHEMA_VERSION,
} from './protocol';

describe('extractRequest', () => {
  it('carries the schema version', () => {
    expect(extractRequest('abc')).toEqual({
      schemaVersion: MESSAGE_SCHEMA_VERSION,
      type: EXTRACT_REQUEST,
      requestId: 'abc',
    });
  });
});

describe('isExtractRequest', () => {
  it('accepts a well-formed request', () => {
    expect(isExtractRequest(extractRequest('abc'))).toBe(true);
  });

  it('rejects a request from a different schema version', () => {
    // An injected script left over from a previous extension build.
    expect(isExtractRequest({ ...extractRequest('abc'), schemaVersion: 2 })).toBe(false);
  });

  it('rejects unrelated messages', () => {
    expect(isExtractRequest({ type: 'something-else', requestId: 'abc', schemaVersion: 1 })).toBe(
      false,
    );
    expect(isExtractRequest(null)).toBe(false);
    expect(isExtractRequest('hello')).toBe(false);
    expect(isExtractRequest({ schemaVersion: 1, type: EXTRACT_REQUEST, requestId: '' })).toBe(
      false,
    );
  });
});

describe('isExtractResponse', () => {
  const response = {
    schemaVersion: MESSAGE_SCHEMA_VERSION,
    type: EXTRACT_RESPONSE,
    requestId: 'abc',
    result: { ok: true },
  };

  it('accepts a matching response', () => {
    expect(isExtractResponse(response, 'abc')).toBe(true);
  });

  it('rejects a response for a different request', () => {
    // Two panels open on two tabs must not read each other's captures.
    expect(isExtractResponse(response, 'def')).toBe(false);
  });

  it('rejects a response with no result', () => {
    expect(isExtractResponse({ ...response, result: undefined }, 'abc')).toBe(false);
  });

  it('rejects a response from a different schema version', () => {
    expect(isExtractResponse({ ...response, schemaVersion: 2 }, 'abc')).toBe(false);
  });
});
