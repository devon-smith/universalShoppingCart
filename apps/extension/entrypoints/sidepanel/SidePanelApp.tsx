import { useSession } from '@/lib/auth/useSession';
import { hasSupabaseConfig } from '@/lib/supabase/config';

import { SignInPanel } from './SignInPanel';
import { SignedInPanel } from './SignedInPanel';

function NotConfigured() {
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

export function SidePanelApp() {
  const configured = hasSupabaseConfig();
  const session = useSession();

  return (
    <main className="panel">
      <header>
        <h1 className="panel__title">Universal Cart</h1>
        <p className="panel__subtitle">
          This build reads no page content and requests no host permissions.
        </p>
      </header>

      {!configured ? <NotConfigured /> : null}
      {configured && session.status === 'loading' ? (
        <p className="panel__subtitle">Restoring your session…</p>
      ) : null}
      {configured && session.status === 'signed-out' ? <SignInPanel /> : null}
      {configured && session.status === 'signed-in' ? (
        <SignedInPanel session={session.session} />
      ) : null}
    </main>
  );
}
