import { Skeleton } from '@universal-cart/ui';
import { useEffect, useState } from 'react';

import { useSession } from '@/lib/auth/useSession';
import type { Preferences } from '@/lib/settings/preferences';
import {
  DEFAULT_PREFERENCES,
  readPreferences,
  themeAttribute,
  writePreferences,
} from '@/lib/settings/preferences';
import { hasSupabaseConfig } from '@/lib/supabase/config';

import { SignInPanel } from './SignInPanel';
import { SignedInPanel } from './SignedInPanel';

/**
 * The build is missing its Supabase configuration.
 *
 * Two audiences, and only one of them can act on the details. A developer who forgot the `.env`
 * needs the variable names; a person who installed this from the Chrome Web Store needs to know
 * it is not their fault and what to do next. Printing the variable names to the second audience
 * is not "extra information", it is a screen that reads as broken software.
 *
 * `import.meta.env.DEV` is true only for `wxt dev`, so a released build never shows the first.
 */
function NotConfigured() {
  if (import.meta.env.DEV) {
    return (
      <section className="panel__section">
        <h2 className="panel__section-title">Not configured</h2>
        <p className="panel__subtitle">
          Set <code>WXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>WXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in <code>apps/extension/.env</code>, then
          rebuild the extension.
        </p>
      </section>
    );
  }

  return (
    <section className="panel__section">
      <h2 className="panel__section-title">Universal Cart cannot start</h2>
      <p className="panel__subtitle">
        This copy of the extension is missing part of its setup, so it cannot reach your account.
        Reinstalling it from the Chrome Web Store should fix it.
      </p>
    </section>
  );
}

/** Restoring a session from extension storage. Usually a few milliseconds, occasionally not. */
function RestoringSession() {
  return (
    <section className="panel__section" aria-busy="true">
      <p className="uc-sr-only" role="status">
        Opening Universal Cart
      </p>
      <Skeleton height="1.25rem" width="60%" />
      <Skeleton height="2.5rem" />
      <Skeleton height="1rem" width="80%" />
    </section>
  );
}

export function SidePanelApp() {
  const configured = hasSupabaseConfig();
  const session = useSession();
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);

  useEffect(() => {
    let active = true;
    void readPreferences(chrome.storage.local).then((stored) => {
      if (active) setPreferences(stored);
    });
    return () => {
      active = false;
    };
  }, []);

  // On the document rather than a subtree, so the choice covers every view including the ones
  // that replace the shell. `system` removes the attribute and lets `prefers-color-scheme` win,
  // which is what keeps the OS setting live when it changes mid-session.
  useEffect(() => {
    const attribute = themeAttribute(preferences.theme);
    if (attribute) {
      document.documentElement.setAttribute('data-theme', attribute);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [preferences.theme]);

  function updatePreferences(patch: Partial<Preferences>) {
    // Optimistic: the theme switches on the click, not after a storage round trip.
    setPreferences((current) => ({ ...current, ...patch }));
    void writePreferences(chrome.storage.local, patch).then(setPreferences);
  }

  return (
    <main className="panel">
      {/* Signed in, the header is `PanelHeader` — it needs the cart list, so `SignedInPanel`
          renders it. Before that there is nothing to select, so the wordmark stands alone. */}
      {session.status === 'signed-in' && configured ? null : (
        <header className="panel-header">
          <h1 className="panel-header__wordmark uc-wordmark">Universal Cart</h1>
        </header>
      )}

      {!configured ? <NotConfigured /> : null}
      {configured && session.status === 'loading' ? <RestoringSession /> : null}
      {configured && session.status === 'signed-out' ? <SignInPanel /> : null}
      {configured && session.status === 'signed-in' ? (
        <SignedInPanel
          session={session.session}
          preferences={preferences}
          onPreferences={updatePreferences}
        />
      ) : null}
    </main>
  );
}
