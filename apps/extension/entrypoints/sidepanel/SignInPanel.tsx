import { useState } from 'react';

import { EmailSignInError, requestEmailCode, verifyEmailCode } from '@/lib/auth/email-otp';
import { GoogleSignInError, signInWithGoogle } from '@/lib/auth/google';
import { publicEnv } from '@/lib/env';
import { getSupabase } from '@/lib/supabase/client';

type Stage = { name: 'idle' } | { name: 'code-sent'; email: string };

function messageFor(error: unknown): string {
  if (error instanceof EmailSignInError || error instanceof GoogleSignInError) {
    return error.message;
  }
  return 'Sign-in failed. Please try again.';
}

export function SignInPanel() {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <section className="panel__section" aria-labelledby="signin-heading">
      <h2 id="signin-heading" className="panel__section-title">
        Sign in
      </h2>
      <p className="panel__subtitle">
        Use the same account as the dashboard so your saved products stay in sync.
      </p>

      {error ? (
        <p role="alert" className="panel__error">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="panel__button"
        disabled={busy}
        onClick={() =>
          run(() => signInWithGoogle({ auth: getSupabase().auth, identity: chrome.identity }))
        }
      >
        Continue with Google
      </button>

      <p className="panel__divider">or</p>

      {stage.name === 'idle' ? (
        <form
          className="panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const sent = await requestEmailCode({
                auth: getSupabase().auth,
                email,
                appUrl: publicEnv.WXT_PUBLIC_APP_URL,
              });
              setStage({ name: 'code-sent', email: sent });
            });
          }}
        >
          <label className="panel__label" htmlFor="signin-email">
            Email address
          </label>
          <input
            id="signin-email"
            className="panel__input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
          <button type="submit" className="panel__button panel__button--primary" disabled={busy}>
            Email me a code
          </button>
        </form>
      ) : (
        <form
          className="panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => verifyEmailCode({ auth: getSupabase().auth, email: stage.email, code }));
          }}
        >
          <label className="panel__label" htmlFor="signin-code">
            6-digit code sent to {stage.email}
          </label>
          <input
            id="signin-code"
            className="panel__input"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
          />
          <button type="submit" className="panel__button panel__button--primary" disabled={busy}>
            Sign in
          </button>
          <button
            type="button"
            className="panel__link-button"
            onClick={() => {
              setStage({ name: 'idle' });
              setCode('');
              setError(null);
            }}
          >
            Use a different email
          </button>
        </form>
      )}
    </section>
  );
}
