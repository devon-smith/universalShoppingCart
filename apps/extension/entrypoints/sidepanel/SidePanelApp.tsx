import { cn } from '@universal-cart/ui';

import { publicEnv } from '@/lib/env';

const upcoming = [
  'Phase 1 — sign in with the same account as the web app',
  'Phase 2 — capture the product on the current tab and save it',
  'Phase 3 — recent cart items and quick edits',
];

export function SidePanelApp() {
  return (
    <main className="panel">
      <header className="panel__header">
        <h1 className="panel__title">Universal Cart</h1>
        <p className="panel__subtitle">Phase 0 — the panel loads, nothing is captured yet.</p>
      </header>

      <section aria-labelledby="upcoming-heading" className="panel__section">
        <h2 id="upcoming-heading" className="panel__section-title">
          What lands next
        </h2>
        <ul className="panel__list">
          {upcoming.map((entry) => (
            <li key={entry} className={cn('panel__list-item')}>
              {entry}
            </li>
          ))}
        </ul>
      </section>

      <footer className="panel__footer">
        This build reads no page content and requests no host permissions. Dashboard:{' '}
        <a href={publicEnv.WXT_PUBLIC_APP_URL} target="_blank" rel="noreferrer">
          {publicEnv.WXT_PUBLIC_APP_URL}
        </a>
      </footer>
    </main>
  );
}
