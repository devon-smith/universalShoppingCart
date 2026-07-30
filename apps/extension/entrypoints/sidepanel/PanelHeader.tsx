import { IconButton } from '@universal-cart/ui';

import { publicEnv } from '@/lib/env';

export interface Cart {
  id: string;
  name: string;
  is_default: boolean;
}

/**
 * The panel's one persistent bar: who you are, which cart you are filling, and the way out to
 * the dashboard.
 *
 * What used to live here was a sentence explaining that the build reads no page content and
 * requests no host permissions. True, and important — and developer-facing, sitting in the most
 * valuable space on the product's most important surface. It moves to a privacy view reachable
 * from the account menu, which 2C builds; the link below is the placeholder for it.
 *
 * The cart selector lives here rather than in the capture form, so there is exactly one control
 * writing that state. The preview confirms the destination in a line of text and offers to move
 * focus here, which keeps "easy to change" without a second select to keep in step.
 */
export function PanelHeader({
  carts,
  cartId,
  onCartChange,
  onAccount,
  cartSelectRef,
}: {
  carts: Cart[];
  cartId: string;
  onCartChange: (id: string) => void;
  onAccount: () => void;
  cartSelectRef?: React.Ref<HTMLSelectElement>;
}) {
  return (
    <header className="panel-header">
      <h1 className="panel-header__wordmark uc-wordmark">Universal Cart</h1>

      <div className="panel-header__actions">
        {carts.length > 0 ? (
          <>
            <label className="uc-sr-only" htmlFor="panel-cart">
              Cart to save into
            </label>
            <select
              id="panel-cart"
              ref={cartSelectRef}
              className="panel-header__cart uc-focusable"
              value={cartId}
              onChange={(event) => onCartChange(event.target.value)}
            >
              {carts.map((cart) => (
                <option key={cart.id} value={cart.id}>
                  {cart.name}
                  {cart.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <a
          className="panel-header__link uc-icon-button uc-focusable"
          href={publicEnv.WXT_PUBLIC_APP_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open the dashboard in a new tab"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
            <path
              d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </a>

        <IconButton
          label="Account and settings"
          onClick={onAccount}
          icon={
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
              <circle cx="12" cy="8.5" r="3.2" strokeWidth="1.6" />
              <path d="M5 20a7 7 0 0 1 14 0" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          }
        />
      </div>
    </header>
  );
}
