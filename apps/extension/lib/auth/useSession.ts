import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { getSupabase } from '../supabase/client';

export type SessionState =
  { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; session: Session };

/**
 * Track the Supabase session.
 *
 * On mount the session is recovered from extension-local storage, so reopening the side
 * panel — or restarting the browser — does not require signing in again.
 * `onAuthStateChange` then keeps the panel in sync with token refreshes and sign-out,
 * including a sign-out that happened in another extension surface.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const supabase = getSupabase();

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setState(
          data.session ? { status: 'signed-in', session: data.session } : { status: 'signed-out' },
        );
      })
      .catch(() => {
        if (active) setState({ status: 'signed-out' });
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setState(session ? { status: 'signed-in', session } : { status: 'signed-out' });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
