import { useEffect, useRef } from 'react';

import { PrivacyContent } from './PrivacyContent';

/**
 * The privacy explanation as its own destination, reached from settings.
 *
 * The heading is an `h1` because this view replaces the panel header rather than sitting under
 * it, so it is the document's only heading — and focus moves to it on arrival, which is what
 * makes a screen reader announce where the user has just landed.
 */
export function PrivacyView({ onBack }: { onBack: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="settings" aria-labelledby="privacy-heading">
      <div className="settings__bar">
        <button type="button" className="settings__back uc-focusable" onClick={onBack}>
          <span aria-hidden="true">←</span> Settings
        </button>
        <h1 id="privacy-heading" className="settings__heading" tabIndex={-1} ref={heading}>
          What Universal Cart can see
        </h1>
      </div>

      <PrivacyContent />
    </section>
  );
}
