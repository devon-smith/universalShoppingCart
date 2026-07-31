/**
 * The two panel preferences that outlive a session.
 *
 * Both live in extension-local storage rather than the database. Neither is shared data: a
 * theme belongs to the machine it is read on, and the cart the panel pre-selects is a property
 * of this browser, not of the account. Putting them in Postgres would mean a migration, a round
 * trip before the first paint, and a row that has to be kept in step with `carts.is_default`
 * for no gain.
 *
 * `is_default` on the cart itself stays the account-wide answer. This only records which cart
 * *this* panel opens on, which is why choosing one here does not rename anybody else's default.
 */

export const PREFERENCES_KEY = 'universal-cart-preferences';

/** `system` follows the OS; the other two override it. */
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Preferences {
  theme: ThemePreference;
  /** The cart the panel opens on. `null` means "whichever the account calls default". */
  defaultCartId: string | null;
}

export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', defaultCartId: null };

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/**
 * Storage is shared, versionless and writable by any past or future build of this extension,
 * so what comes back is untrusted input and gets validated like any other (CLAUDE.md).
 */
export function parsePreferences(raw: unknown): Preferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFERENCES;

  const value = raw as Record<string, unknown>;
  const theme = value.theme;
  const cartId = value.defaultCartId;

  return {
    theme: THEMES.includes(theme as ThemePreference) ? (theme as ThemePreference) : 'system',
    defaultCartId: typeof cartId === 'string' && cartId.length > 0 ? cartId : null,
  };
}

/** The part of `chrome.storage.local` this module uses. */
export interface PreferenceStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export async function readPreferences(store: PreferenceStore): Promise<Preferences> {
  try {
    const stored = await store.get(PREFERENCES_KEY);
    return parsePreferences(stored[PREFERENCES_KEY]);
  } catch {
    // A panel that will not open because a preference could not be read is worse than a
    // panel in the default theme.
    return DEFAULT_PREFERENCES;
  }
}

export async function writePreferences(
  store: PreferenceStore,
  patch: Partial<Preferences>,
): Promise<Preferences> {
  const current = await readPreferences(store);
  const next: Preferences = { ...current, ...patch };
  await store.set({ [PREFERENCES_KEY]: next });
  return next;
}

/**
 * The theme actually applied to the document.
 *
 * `system` resolves to nothing at all — the stylesheet's `prefers-color-scheme` query is left
 * to answer, which is what makes the OS setting keep working after it changes mid-session.
 */
export function themeAttribute(preference: ThemePreference): 'light' | 'dark' | null {
  return preference === 'system' ? null : preference;
}
