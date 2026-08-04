import { Button, Callout, TextInput } from '@universal-cart/ui';
import { useEffect, useRef, useState } from 'react';

import { EmailSignInError, requestEmailCode, verifyEmailCode } from '@/lib/auth/email-otp';
import { GoogleSignInError, signInWithGoogle } from '@/lib/auth/google';
import { describeSignInFailure } from '@/lib/auth/messages';
import type { EnabledProviders } from '@/lib/auth/providers';
import { PROVIDERS_UNKNOWN, fetchEnabledProviders } from '@/lib/auth/providers';
import { publicEnv } from '@/lib/env';
import { getSupabase } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

import { PrivacyContent } from './PrivacyContent';

type Stage = { name: 'idle' } | { name: 'code-sent'; email: string };

/**
 * Three things the product does, in the order somebody discovers them.
 *
 * Each is a claim about shipped behaviour. "Prices as they were last checked" is deliberately
 * not "we watch the price" — nothing runs in the background yet (BUILD_PLAN.md §14.2), and an
 * onboarding screen is exactly where an overclaim would be believed.
 */
const BENEFITS = [
  'Save anything you are considering, from any shop, in one click.',
  'See the options side by side instead of across fifteen tabs.',
  'Your list follows you to every browser you sign in on.',
] as const;

function messageFor(error: unknown): string {
  if (error instanceof EmailSignInError || error instanceof GoogleSignInError) {
    return error.message;
  }
  return 'Sign-in failed. Please try again.';
}

/**
 * The first thing anybody sees.
 *
 * It used to be a heading reading "Sign in" above two controls, which asks a person to hand
 * over an address before telling them what they get for it. The extension has just been
 * installed; nothing about it is obvious yet.
 *
 * So: what this is, three things it does, then the form. The form is unchanged in mechanism —
 * a one-time code, verified inside the panel, because the panel cannot follow an emailed link
 * into a browser tab whose cookies are not its session storage (lib/auth/email-otp.ts).
 *
 * Google appears only where the Auth server says the provider is configured. A button that can
 * only fail is worse than an absent one: the user concludes their Google account is the problem.
 */
export function SignInPanel() {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<EnabledProviders | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { url, publishableKey } = getSupabaseConfig();

    fetchEnabledProviders({
      url,
      publishableKey,
      fetch: globalThis.fetch,
      signal: controller.signal,
    })
      .then(setProviders)
      .catch(() => setProviders(PROVIDERS_UNKNOWN));

    return () => controller.abort();
  }, []);

  // Sending the code moves the one thing worth doing to a new field. Focus follows it, so a
  // keyboard or screen-reader user is not left at the top of a screen that just changed.
  useEffect(() => {
    if (stage.name === 'code-sent') codeInput.current?.focus();
  }, [stage.name]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  function sendCode(address: string) {
    return run(async () => {
      const sent = await requestEmailCode({
        auth: getSupabase().auth,
        email: address,
        appUrl: publicEnv.WXT_PUBLIC_APP_URL,
      });
      setCode('');
      setStage({ name: 'code-sent', email: sent });
    });
  }

  const failure = error === null ? null : describeSignInFailure(error);

  return (
    <div className="onboarding">
      <section className="onboarding__pitch" aria-labelledby="onboarding-heading">
        <h2 id="onboarding-heading" className="onboarding__promise">
          Everything you are considering, in one place
        </h2>
        <ul className="onboarding__benefits">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="onboarding__benefit">
              {benefit}
            </li>
          ))}
        </ul>
      </section>

      <section className="onboarding__auth" aria-labelledby="signin-heading">
        <h3 id="signin-heading" className="onboarding__auth-heading">
          Sign in
        </h3>

        {failure ? (
          <Callout tone="danger" title={failure.title}>
            {/* A span, not a paragraph: `Callout` already wraps its children in one. */}
            {failure.body ? <span className="onboarding__failure-body">{failure.body}</span> : null}
            {failure.canResend && stage.name === 'code-sent' ? (
              <button
                type="button"
                className="onboarding__inline-action uc-focusable"
                disabled={busy}
                onClick={() => void sendCode(stage.email)}
              >
                Send a new code
              </button>
            ) : null}
          </Callout>
        ) : null}

        {stage.name === 'idle' ? (
          <form
            className="onboarding__form"
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode(email);
            }}
          >
            <TextInput
              label="Email address"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
            <Button type="submit" tone="primary" fullWidth disabled={busy}>
              {busy ? 'Sending…' : 'Email me a code'}
            </Button>
            <p className="onboarding__note">
              We will email you a one-time code. No password to invent or forget.
            </p>
          </form>
        ) : (
          <form
            className="onboarding__form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() =>
                verifyEmailCode({ auth: getSupabase().auth, email: stage.email, code }),
              );
            }}
          >
            <p className="onboarding__sent" role="status">
              Code sent to <strong>{stage.email}</strong>. It expires in an hour.
            </p>
            <TextInput
              ref={codeInput}
              label={`One-time code sent to ${stage.email}`}
              labelHidden
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
            />
            <Button type="submit" tone="primary" fullWidth disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
            <div className="onboarding__alternatives">
              <button
                type="button"
                className="onboarding__inline-action uc-focusable"
                disabled={busy}
                onClick={() => void sendCode(stage.email)}
              >
                Send another code
              </button>
              <button
                type="button"
                className="onboarding__inline-action uc-focusable"
                onClick={() => {
                  setStage({ name: 'idle' });
                  setCode('');
                  setError(null);
                }}
              >
                Use a different address
              </button>
            </div>
          </form>
        )}

        {/* Nothing is rendered while the provider probe is in flight. A spinner here would be a
            second live region competing with the code-sent message, announcing a wait nobody is
            waiting on: email sign-in is complete and usable throughout, and Google is an extra
            that appears if it exists. */}
        {providers?.google ? (
          <>
            <p className="onboarding__divider">
              <span>or</span>
            </p>
            <Button
              fullWidth
              disabled={busy}
              onClick={() =>
                void run(() =>
                  signInWithGoogle({ auth: getSupabase().auth, identity: chrome.identity }),
                )
              }
            >
              Continue with Google
            </Button>
          </>
        ) : null}
      </section>

      <details className="onboarding__privacy">
        <summary className="onboarding__privacy-summary uc-focusable">
          What Universal Cart can see
        </summary>
        <PrivacyContent />
      </details>
    </div>
  );
}
