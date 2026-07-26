import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { publicEnv } from '@/lib/env';
import { getSupabase } from '@/lib/supabase/client';

type Cart = { id: string; name: string; is_default: boolean };

type CartsState =
  { status: 'loading' } | { status: 'ready'; carts: Cart[] } | { status: 'error'; message: string };

export function SignedInPanel({ session }: { session: Session }) {
  const [carts, setCarts] = useState<CartsState>({ status: 'loading' });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;

    getSupabase()
      .from('carts')
      .select('id, name, is_default')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!active) return;
        setCarts(
          error
            ? { status: 'error', message: error.message }
            : { status: 'ready', carts: data ?? [] },
        );
      });

    return () => {
      active = false;
    };
  }, [session.user.id]);

  return (
    <>
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

      <section className="panel__section" aria-labelledby="carts-heading">
        <h2 id="carts-heading" className="panel__section-title">
          Carts
        </h2>
        {carts.status === 'loading' ? <p className="panel__subtitle">Loading…</p> : null}
        {carts.status === 'error' ? (
          <p role="alert" className="panel__error">
            {carts.message}
          </p>
        ) : null}
        {carts.status === 'ready' ? (
          <ul className="panel__list">
            {carts.carts.map((cart) => (
              <li key={cart.id} className="panel__list-item">
                {cart.name}
                {cart.is_default ? ' · default' : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <footer className="panel__footer">
        Product capture arrives in Phase 2. Dashboard:{' '}
        <a href={publicEnv.WXT_PUBLIC_APP_URL} target="_blank" rel="noreferrer">
          {publicEnv.WXT_PUBLIC_APP_URL}
        </a>
      </footer>
    </>
  );
}
