/**
 * Email one-time-code sign-in for the extension.
 *
 * The side panel cannot follow an email link — a link opens a browser tab, whose cookies
 * are not the extension's session storage. Requesting a code and verifying it inside the
 * panel keeps the whole exchange in the extension, so the resulting session lands in
 * extension-local storage like every other extension session.
 *
 * This is the fallback for when Google sign-in is unavailable.
 */

/** The part of the Supabase auth client this flow uses. */
export interface OtpCapableAuth {
  signInWithOtp(params: {
    email: string;
    options: { shouldCreateUser: boolean; emailRedirectTo: string };
  }): Promise<{ error: { message: string } | null }>;
  verifyOtp(params: {
    email: string;
    token: string;
    type: 'email';
  }): Promise<{ error: { message: string } | null }>;
}

export class EmailSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSignInError';
  }
}

// Deliberately permissive: the authoritative check is the Auth server's. This only
// catches obvious typos before spending a round trip and an email.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  const email = raw.trim();
  if (!EMAIL_PATTERN.test(email)) {
    throw new EmailSignInError('Enter a valid email address.');
  }
  return email.toLowerCase();
}

export function normalizeCode(raw: string): string {
  // Users paste codes with stray spaces and dashes; strip them before comparing.
  const code = raw.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(code)) {
    throw new EmailSignInError('Enter the 6-digit code from the email.');
  }
  return code;
}

export async function requestEmailCode(deps: {
  auth: OtpCapableAuth;
  email: string;
  /** Dashboard origin. The same email also carries a link, which belongs to the web app. */
  appUrl: string;
}): Promise<string> {
  const email = normalizeEmail(deps.email);
  const { error } = await deps.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${deps.appUrl.replace(/\/$/, '')}/auth/confirm?next=%2Fapp`,
    },
  });

  if (error) {
    throw new EmailSignInError(error.message);
  }

  return email;
}

export async function verifyEmailCode(deps: {
  auth: OtpCapableAuth;
  email: string;
  code: string;
}): Promise<void> {
  const email = normalizeEmail(deps.email);
  const token = normalizeCode(deps.code);

  const { error } = await deps.auth.verifyOtp({ email, token, type: 'email' });

  if (error) {
    throw new EmailSignInError(error.message);
  }
}
