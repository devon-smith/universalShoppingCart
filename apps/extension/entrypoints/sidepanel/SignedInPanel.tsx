import type { Session } from '@supabase/supabase-js';
import { useState } from 'react';

import { publicEnv } from '@/lib/env';
import { getSupabase } from '@/lib/supabase/client';

import { CapturePanel } from './CapturePanel';
import { RecentItems } from './RecentItems';

export function SignedInPanel({ session }: { session: Session }) {
  const [signingOut, setSigningOut] = useState(false);
  // Bumped after a save so the recent list reflects it without a full reload.
  const [savedCount, setSavedCount] = useState(0);

  return (
    <>
      <CapturePanel onSaved={() => setSavedCount((count) => count + 1)} />

      <RecentItems reloadKey={savedCount} />

      <section className="panel__section" aria-labelledby="account-heading">
        <h2 id="account-heading" className="panel__section-title">
          Account
        </h2>
        <p className="panel__subtitle">{session.user.email ?? session.user.id}</p>
        <button
          type="button"
          className="panel__button"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void getSupabase()
              .auth.signOut()
              .finally(() => setSigningOut(false));
          }}
        >
          Sign out
        </button>
      </section>

      <footer className="panel__footer">
        Dashboard:{' '}
        <a href={publicEnv.WXT_PUBLIC_APP_URL} target="_blank" rel="noreferrer">
          {publicEnv.WXT_PUBLIC_APP_URL}
        </a>
      </footer>
    </>
  );
}
