import type { Session } from '@supabase/supabase-js';
import { Button } from '@universal-cart/ui';
import { useEffect, useRef, useState } from 'react';

import { getSupabase } from '@/lib/supabase/client';

import { CapturePanel } from './CapturePanel';
import type { Cart } from './PanelHeader';
import { PanelHeader } from './PanelHeader';
import { RecentItems } from './RecentItems';

export function SignedInPanel({ session }: { session: Session }) {
  const [signingOut, setSigningOut] = useState(false);
  // Bumped after a save so the recent list reflects it without a full reload.
  const [savedCount, setSavedCount] = useState(0);
  const [carts, setCarts] = useState<Cart[]>([]);
  const [cartId, setCartId] = useState('');
  const [showAccount, setShowAccount] = useState(false);
  const cartSelect = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let active = true;

    getSupabase()
      .from('carts')
      .select('id, name, is_default')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!active || !data) return;
        setCarts(data);
        setCartId((current) => current || (data[0]?.id ?? ''));
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PanelHeader
        carts={carts}
        cartId={cartId}
        onCartChange={setCartId}
        onAccount={() => setShowAccount((open) => !open)}
        cartSelectRef={cartSelect}
      />

      <CapturePanel
        onSaved={() => setSavedCount((count) => count + 1)}
        carts={carts}
        cartId={cartId}
        onChangeCart={() => cartSelect.current?.focus()}
      />

      <RecentItems reloadKey={savedCount} />

      {/* 2C builds the real account and privacy view. Until then the menu reveals what it
          already had — identity and a way out — rather than the header carrying it. */}
      {showAccount ? (
        <section className="panel__section" aria-labelledby="account-heading">
          <h2 id="account-heading" className="panel__section-title">
            Account
          </h2>
          <p className="panel__subtitle">{session.user.email ?? session.user.id}</p>
          <Button
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void getSupabase()
                .auth.signOut()
                .finally(() => setSigningOut(false));
            }}
          >
            Sign out
          </Button>
        </section>
      ) : null}
    </>
  );
}
