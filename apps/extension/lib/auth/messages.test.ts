import { describe, expect, it } from 'vitest';

import { describeSignInFailure } from './messages';

describe('describeSignInFailure', () => {
  it('offers a resend for the message Supabase sends on a bad or expired code', () => {
    const failure = describeSignInFailure('Token has expired or is invalid');

    expect(failure.canResend).toBe(true);
    expect(failure.title).toBe('That code did not work');
  });

  it('does not claim the code expired, because the server does not say which it was', () => {
    const failure = describeSignInFailure('Token has expired or is invalid');

    // Both readings, or neither — never one asserted as fact.
    expect(failure.body).toMatch(/Codes last one hour/);
    expect(`${failure.title} ${failure.body}`).not.toMatch(/your code (has )?expired/i);
  });

  it('tells a rate-limited user to wait rather than to resend, which would fail again', () => {
    const failure = describeSignInFailure(
      'For security purposes, you can only request this after 51 seconds.',
    );

    expect(failure.canResend).toBe(false);
    expect(failure.title).toBe('Too many codes requested');
  });

  it('names the connection when the request never reached the server', () => {
    expect(describeSignInFailure('Failed to fetch').title).toBe('Could not reach Universal Cart');
  });

  it('passes an unrecognised message through rather than inventing a friendlier lie', () => {
    const failure = describeSignInFailure('Signups not allowed for this instance');

    expect(failure.title).toBe('Sign-in failed');
    expect(failure.body).toBe('Signups not allowed for this instance');
    expect(failure.canResend).toBe(false);
  });

  it('leaves our own validation as the one sentence it already is', () => {
    const failure = describeSignInFailure('Enter a valid email address.');

    // Not wrapped in "Sign-in failed" — nothing failed, the address was never sent.
    expect(failure.title).toBe('Enter a valid email address.');
    expect(failure.body).toBe('');
  });

  it('leaves the code-format message alone too', () => {
    expect(describeSignInFailure('Enter the 6-digit code from the email.').title).toBe(
      'Enter the 6-digit code from the email.',
    );
  });
});
