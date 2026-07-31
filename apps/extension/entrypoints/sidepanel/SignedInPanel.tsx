import type { Session } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';

import type { Preferences } from '@/lib/settings/preferences';
import { getSupabase } from '@/lib/supabase/client';

import { CapturePanel } from './CapturePanel';
import type { Cart } from './PanelHeader';
import { PanelHeader } from './PanelHeader';
import { PrivacyView } from './PrivacyView';
import { RecentItems } from './RecentItems';
import { SettingsView } from './SettingsView';

/** The panel's three destinations. Capture is home; the other two are reached from the menu. */
type View = 'capture' | 'settings' | 'privacy';

/**
 * The signed-in panel.
 *
 * Settings and privacy replace the capture surface rather than expanding below it. At 320px a
 * disclosure that pushes the primary action off the bottom of the panel is not a lighter
 * treatment than a view, it is the same content plus a scroll — and the panel is a phone-width
 * column, where a screen you go to and come back from is the familiar shape.
 */
export function SignedInPanel({
  session,
  preferences,
  onPreferences,
}: {
  session: Session;
  preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => void;
}) {
  // Bumped after a save so the recent list reflects it without a full reload.
  const [savedCount, setSavedCount] = useState(0);
  const [carts, setCarts] = useState<Cart[]>([]);
  // The cart the user picked in the header this session, if they picked one at all. The
  // effective destination is derived below rather than stored, so a cart list that arrives
  // late — or a preferred cart deleted on another device — cannot leave the two disagreeing.
  const [chosenCartId, setChosenCartId] = useState<string | null>(null);
  const [view, setView] = useState<View>('capture');
  const cartSelect = useRef<HTMLSelectElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  // Set when a subview was opened from this panel, so focus returns only after a real trip
  // away — not on first mount, where it would steal focus from the page.
  const returning = useRef(false);

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
      });

    return () => {
      active = false;
    };
  }, []);

  // This session's choice first, then the stored preference, then whichever cart the account
  // calls default — each only if it is still a cart that exists.
  const exists = (id: string | null) => Boolean(id) && carts.some((cart) => cart.id === id);
  const cartId = exists(chosenCartId)
    ? chosenCartId!
    : exists(preferences.defaultCartId)
      ? preferences.defaultCartId!
      : (carts[0]?.id ?? '');

  useEffect(() => {
    if (view === 'capture' && returning.current) {
      returning.current = false;
      accountButton.current?.focus();
    }
  }, [view]);

  if (view === 'settings') {
    return (
      <SettingsView
        session={session}
        carts={carts}
        preferences={preferences}
        onPreferences={onPreferences}
        onPrivacy={() => setView('privacy')}
        onBack={() => setView('capture')}
      />
    );
  }

  if (view === 'privacy') {
    return <PrivacyView onBack={() => setView('settings')} />;
  }

  return (
    <>
      <PanelHeader
        carts={carts}
        cartId={cartId}
        onCartChange={setChosenCartId}
        onAccount={() => {
          returning.current = true;
          setView('settings');
        }}
        cartSelectRef={cartSelect}
        accountButtonRef={accountButton}
      />

      <CapturePanel
        onSaved={() => setSavedCount((count) => count + 1)}
        carts={carts}
        cartId={cartId}
        onChangeCart={() => cartSelect.current?.focus()}
      />

      <RecentItems reloadKey={savedCount} />
    </>
  );
}
