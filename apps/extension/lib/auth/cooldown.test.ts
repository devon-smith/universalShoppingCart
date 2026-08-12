import { describe, expect, it } from 'vitest';

import { RESEND_COOLDOWN_MS, resendRemainingSeconds } from './cooldown';

describe('resendRemainingSeconds', () => {
  it('is zero before anything was sent', () => {
    expect(resendRemainingSeconds(null, 1_000)).toBe(0);
  });

  it('counts down from the send and reaches zero exactly at the cooldown', () => {
    const sentAt = 10_000;
    expect(resendRemainingSeconds(sentAt, sentAt)).toBe(60);
    expect(resendRemainingSeconds(sentAt, sentAt + 30_500)).toBe(30);
    expect(resendRemainingSeconds(sentAt, sentAt + RESEND_COOLDOWN_MS)).toBe(0);
  });

  it('rounds part-seconds up, so the label never shows 0 while still disabled', () => {
    const sentAt = 0;
    expect(resendRemainingSeconds(sentAt, RESEND_COOLDOWN_MS - 1)).toBe(1);
  });

  it('never goes negative, however stale the clock', () => {
    expect(resendRemainingSeconds(0, RESEND_COOLDOWN_MS * 5)).toBe(0);
  });
});
