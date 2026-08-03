/**
 * Relative time, phrased for a surface that must not overclaim.
 *
 * The panel says when something was *observed*, and observation only happens when the user
 * visits the page or explicitly refreshes. Nothing is watched in the background yet
 * (BUILD_PLAN.md §14.2), so the words here stay in the past tense and never imply monitoring:
 * "last checked 2h ago" is a fact about a thing that happened, "we've been watching" is not.
 */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'not checked yet';

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'not checked yet';

  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return then.toLocaleDateString();
}
