'use client';

import { Toast } from '@universal-cart/ui';

/**
 * Everything the dashboard says back to you, in one place.
 *
 * The states were scattered before: an inline `role="alert"` paragraph for a failed write, two
 * near-identical fixed divs for undo and for delete confirmation, and nothing at all for a
 * successful save. Each had its own markup and its own live-region behaviour, which is how a
 * screen reader ends up hearing one message twice and another not at all.
 *
 * One component, one rule about announcing:
 *
 * - **assertive** (`alert`) only for something that failed and needs attention now. It
 *   interrupts, which is the right trade for "your change did not save" and the wrong one for
 *   everything else.
 * - **polite** (`status`) for confirmations. They wait for a pause.
 *
 * A message with an action keeps the action *inside* the live region, so "Archived — Undo" is
 * announced as one thing rather than a sentence followed by an orphaned button.
 */

export type AnnouncementTone = 'success' | 'failure';

export interface Announcement {
  tone: AnnouncementTone;
  message: string;
  /** Present only where an action genuinely reverses what just happened. */
  action?: { label: string; run: () => void };
  /** Marks the node for tests that assert on a specific confirmation. */
  testId?: string;
}

export function Announcements({ announcement }: { announcement: Announcement | null }) {
  if (!announcement) return null;

  const assertive = announcement.tone === 'failure';

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
      // The region is always mounted at this position, but only carries a child when there is
      // something to say — a live region added to the DOM at the same moment as its text is
      // unreliably announced across screen readers.
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      data-testid={announcement.testId}
    >
      <div className="pointer-events-auto">
        <Toast
          announce={false}
          message={announcement.message}
          action={
            announcement.action ? (
              <button
                type="button"
                className="uc-focusable rounded-[var(--uc-radius-control)] px-1 font-semibold text-[var(--uc-primary)] underline"
                onClick={announcement.action.run}
              >
                {announcement.action.label}
              </button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
