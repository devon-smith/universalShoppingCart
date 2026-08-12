import { describe, expect, it } from 'vitest';

import { describeSendFailure } from './sign-in-copy';

describe('describeSendFailure', () => {
  it('turns the send throttle into an instruction, and says the last email still works', () => {
    const friendly = describeSendFailure(
      'For security purposes, you can only request this after 51 seconds.',
    );

    expect(friendly).toMatch(/wait a minute/i);
    expect(friendly).toMatch(/last email still works/i);
    // The server's countdown is gone — it is stale the moment it renders.
    expect(friendly).not.toMatch(/51/);
  });

  it('recognises the other spellings the server uses for the same throttle', () => {
    expect(describeSendFailure('Email rate limit exceeded')).toMatch(/wait a minute/i);
    expect(describeSendFailure('Too many requests')).toMatch(/wait a minute/i);
  });

  it('passes an unrecognised failure through rather than inventing a friendlier lie', () => {
    expect(describeSendFailure('Signups not allowed for this instance')).toBe(
      'Signups not allowed for this instance',
    );
  });
});
