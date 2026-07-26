/**
 * Post-sign-in redirect handling.
 *
 * The `next` parameter comes from the URL, so it is attacker-controlled. Only
 * same-origin absolute paths are honoured; anything else falls back to the dashboard.
 * Without this, a crafted link could bounce a freshly signed-in user to another site.
 */
export const DEFAULT_SIGNED_IN_PATH = '/app';

/**
 * Backslashes and control characters appear in a `next` value only to confuse a URL
 * parser or to smuggle a line break into a `Location` header.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

export function safeRedirectPath(candidate: string | null | undefined): string {
  if (!candidate) return DEFAULT_SIGNED_IN_PATH;

  // Reject absolute URLs and protocol-relative paths such as `//evil.example.com`.
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return DEFAULT_SIGNED_IN_PATH;
  }

  if (UNSAFE_CHARACTERS.test(candidate)) {
    return DEFAULT_SIGNED_IN_PATH;
  }

  return candidate;
}
