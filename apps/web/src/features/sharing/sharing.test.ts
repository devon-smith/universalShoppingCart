import { describe, expect, it } from 'vitest';

import {
  acceptFailureMessage,
  acceptFailureReason,
  formatExpiry,
  inviteUrl,
  isPending,
  roleDescription,
  roleLabel,
  ttlToInterval,
} from './sharing';

describe('inviteUrl', () => {
  const token = 'a'.repeat(64);

  it('joins the token onto the app origin', () => {
    expect(inviteUrl('https://cart.example', token)).toBe(`https://cart.example/invite/${token}`);
  });

  it('does not double a trailing slash on the base URL', () => {
    expect(inviteUrl('https://cart.example/', token)).toBe(`https://cart.example/invite/${token}`);
  });
});

describe('ttlToInterval', () => {
  it('omits the argument when no lifetime was chosen, so the RPC default stands', () => {
    expect(ttlToInterval(undefined)).toBeUndefined();
  });

  it('renders a chosen lifetime as a Postgres interval', () => {
    expect(ttlToInterval(24)).toBe('24 hours');
    expect(ttlToInterval(1)).toBe('1 hours');
  });
});

describe('acceptFailureReason', () => {
  it('reads not-found from the no_data_found SQLSTATE (P0002, not 02000)', () => {
    expect(acceptFailureReason({ code: 'P0002', message: 'Invitation not found' })).toBe(
      'not_found',
    );
  });

  it('tells expired from already-accepted, which share SQLSTATE 22023, by message', () => {
    expect(acceptFailureReason({ code: '22023', message: 'Invitation has expired' })).toBe(
      'expired',
    );
    expect(acceptFailureReason({ code: '22023', message: 'Invitation already accepted' })).toBe(
      'already_accepted',
    );
  });

  it('maps the auth and malformed SQLSTATEs', () => {
    expect(acceptFailureReason({ code: '42501', message: 'Not authenticated' })).toBe(
      'unauthenticated',
    );
    expect(acceptFailureReason({ code: '22P02', message: 'Malformed' })).toBe('invalid');
  });

  it('falls back to unknown for an unmapped code, so a message always exists', () => {
    expect(acceptFailureReason({ code: '40001', message: 'serialization failure' })).toBe(
      'unknown',
    );
    expect(acceptFailureReason({})).toBe('unknown');
  });
});

describe('acceptFailureMessage', () => {
  it('gives every failure a distinct, actionable sentence', () => {
    const reasons = [
      'not_found',
      'expired',
      'already_accepted',
      'unauthenticated',
      'invalid',
      'unknown',
    ] as const;
    const messages = reasons.map(acceptFailureMessage);
    expect(new Set(messages).size).toBe(reasons.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });
});

describe('isPending', () => {
  const now = new Date('2026-08-03T12:00:00Z');

  it('is pending when unaccepted and not yet expired', () => {
    expect(isPending({ accepted_at: null, expires_at: '2026-08-04T12:00:00Z' }, now)).toBe(true);
  });

  it('is not pending once accepted, even if still in date', () => {
    expect(
      isPending({ accepted_at: '2026-08-03T11:00:00Z', expires_at: '2026-08-04T12:00:00Z' }, now),
    ).toBe(false);
  });

  it('is not pending once expired', () => {
    expect(isPending({ accepted_at: null, expires_at: '2026-08-03T11:59:59Z' }, now)).toBe(false);
  });
});

describe('formatExpiry', () => {
  const now = new Date('2026-08-03T12:00:00Z');

  it('reads days, hours, soon, and expired', () => {
    expect(formatExpiry('2026-08-09T12:00:00Z', now)).toBe('in 6 days');
    expect(formatExpiry('2026-08-04T00:00:00Z', now)).toBe('in 12 hours');
    expect(formatExpiry('2026-08-03T12:30:00Z', now)).toBe('soon');
    expect(formatExpiry('2026-08-03T11:00:00Z', now)).toBe('expired');
  });

  it('singularises one hour, and shows hours right up to the two-day cutover', () => {
    expect(formatExpiry('2026-08-03T13:00:00Z', now)).toBe('in 1 hour');
    // 47h stays in hours; 48h is the first "in 2 days".
    expect(formatExpiry('2026-08-05T11:00:00Z', now)).toBe('in 47 hours');
    expect(formatExpiry('2026-08-05T12:00:00Z', now)).toBe('in 2 days');
  });
});

describe('roleDescription', () => {
  it('distinguishes editor from viewer', () => {
    expect(roleDescription('editor')).not.toBe(roleDescription('viewer'));
    expect(roleDescription('editor').length).toBeGreaterThan(0);
    expect(roleDescription('viewer').length).toBeGreaterThan(0);
  });
});

describe('roleLabel', () => {
  it('capitalises as real text, so a control accessible name matches the visible label', () => {
    expect(roleLabel('editor')).toBe('Editor');
    expect(roleLabel('viewer')).toBe('Viewer');
    expect(roleLabel('owner')).toBe('Owner');
  });

  it('leaves an empty string alone', () => {
    expect(roleLabel('')).toBe('');
  });
});
