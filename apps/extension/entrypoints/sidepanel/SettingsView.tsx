import type { Session } from '@supabase/supabase-js';
import { Button } from '@universal-cart/ui';
import { useEffect, useRef, useState } from 'react';

import { publicEnv } from '@/lib/env';
import type { Preferences, ThemePreference } from '@/lib/settings/preferences';
import { readCaptureShortcut } from '@/lib/settings/shortcut';
import { getSupabase } from '@/lib/supabase/client';

import type { Cart } from './PanelHeader';

const THEME_CHOICES: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Account and settings.
 *
 * Deliberately short. A side panel is 320 to 500 pixels wide and its job is capture; every row
 * here is one a person has a reason to open the menu for. There is no notification section, no
 * data-export section and no sync toggle, because none of those exist yet — a settings screen
 * full of controls for unbuilt features is a list of promises.
 *
 * The two real preferences are appearance and which cart the panel opens on. Both are stored in
 * extension-local storage: they describe this browser, not the account (lib/settings/preferences.ts).
 */
export function SettingsView({
  session,
  carts,
  preferences,
  onPreferences,
  onPrivacy,
  onBack,
  arrivedFrom = 'panel',
}: {
  session: Session;
  carts: Cart[];
  preferences: Preferences;
  onPreferences: (patch: Partial<Preferences>) => void;
  onPrivacy: () => void;
  onBack: () => void;
  /**
   * Where the user came from, which decides where the keyboard lands.
   *
   * Arriving from the panel is a new destination and the heading announces it. Coming *back*
   * from privacy is a return, and a return that dumps focus at the top of the screen makes
   * the user hunt for the link they just followed.
   */
  arrivedFrom?: 'panel' | 'privacy';
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [shortcut, setShortcut] = useState<string | null | 'unknown'>('unknown');
  const heading = useRef<HTMLHeadingElement>(null);
  const privacyLink = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void readCaptureShortcut(chrome.commands).then((value) => {
      if (active) setShortcut(value);
    });
    return () => {
      active = false;
    };
  }, []);

  // Focus lands on the view's name, so arriving here is announced rather than silent — or on
  // the link that led away, when this is the way back from it.
  useEffect(() => {
    if (arrivedFrom === 'privacy') privacyLink.current?.focus();
    else heading.current?.focus();
    // Once, on arrival. A later re-render is not a navigation and must not move focus out of
    // whatever control the user is currently operating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountDefault = carts.find((cart) => cart.is_default);
  const dashboard = publicEnv.WXT_PUBLIC_APP_URL.replace(/\/$/, '');

  return (
    <section className="settings" aria-labelledby="settings-heading">
      <div className="settings__bar">
        <button type="button" className="settings__back uc-focusable" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
        <h1 id="settings-heading" className="settings__heading" tabIndex={-1} ref={heading}>
          Settings
        </h1>
      </div>

      <div className="settings__group">
        <p className="settings__label">Signed in as</p>
        <p className="settings__account">{session.user.email ?? session.user.id}</p>
      </div>

      <div className="settings__group">
        <span className="settings__label" id="settings-theme-label">
          Appearance
        </span>
        {/* A radio group rather than a select: three options, all worth seeing at once, and
            the current one readable without opening anything. */}
        <div className="settings__choices" role="radiogroup" aria-labelledby="settings-theme-label">
          {THEME_CHOICES.map((choice) => (
            <label key={choice.value} className="settings__choice">
              <input
                type="radio"
                name="appearance"
                className="uc-sr-only"
                value={choice.value}
                checked={preferences.theme === choice.value}
                onChange={() => onPreferences({ theme: choice.value })}
              />
              <span className="settings__choice-face uc-focusable">{choice.label}</span>
            </label>
          ))}
        </div>
      </div>

      {carts.length > 0 ? (
        <div className="settings__group">
          <label className="settings__label" htmlFor="settings-cart">
            Cart this panel opens on
          </label>
          <select
            id="settings-cart"
            className="uc-input uc-focusable"
            value={preferences.defaultCartId ?? ''}
            onChange={(event) => onPreferences({ defaultCartId: event.target.value || null })}
          >
            <option value="">
              {accountDefault ? `Account default (${accountDefault.name})` : 'Account default'}
            </option>
            {carts.map((cart) => (
              <option key={cart.id} value={cart.id}>
                {cart.name}
              </option>
            ))}
          </select>
          <p className="settings__hint">
            Only changes where this browser starts. You can still pick a different cart each time
            you save.
          </p>
        </div>
      ) : null}

      <div className="settings__group">
        <p className="settings__label">Keyboard shortcut</p>
        {shortcut === 'unknown' ? (
          <p className="settings__hint">Checking…</p>
        ) : shortcut ? (
          <p className="settings__body">
            Press <kbd className="capture__kbd">{shortcut}</kbd> on a product page to capture it.
          </p>
        ) : (
          <p className="settings__body">
            No shortcut is assigned — another extension may have claimed it.
          </p>
        )}
        <button
          type="button"
          className="settings__link uc-focusable"
          onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
        >
          Change shortcut
        </button>
      </div>

      <div className="settings__group">
        <p className="settings__label">Privacy</p>
        <p className="settings__body">
          Universal Cart reads a product page only when you ask it to, and never your cookies, your
          history, or your other tabs.
        </p>
        <button
          type="button"
          ref={privacyLink}
          className="settings__link uc-focusable"
          onClick={onPrivacy}
        >
          What Universal Cart can see
        </button>
      </div>

      <div className="settings__group">
        <p className="settings__label">Dashboard</p>
        <div className="settings__links">
          <a className="settings__link" href={`${dashboard}/app`} target="_blank" rel="noreferrer">
            Open your carts
          </a>
          <a
            className="settings__link"
            href={`${dashboard}/app/diagnostics`}
            target="_blank"
            rel="noreferrer"
          >
            Extraction diagnostics
          </a>
        </div>
      </div>

      <div className="settings__group settings__group--last">
        <Button
          tone="ghost"
          fullWidth
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void getSupabase()
              .auth.signOut()
              .finally(() => setSigningOut(false));
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </section>
  );
}
