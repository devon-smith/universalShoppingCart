import { expect } from '@playwright/test';

/**
 * Minimal Mailpit reader for the local Supabase stack.
 *
 * Reading the real email rather than generating a link through the admin API means the
 * suite also covers the magic-link template, which is where the confirmation URL shape
 * actually lives.
 */
const mailpitUrl = process.env.SUPABASE_MAILPIT_URL ?? 'http://127.0.0.1:54324';

interface MessageSummary {
  ID: string;
  To: Array<{ Address: string }>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${mailpitUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Mailpit ${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * A per-address view of the inbox that hands back each message once.
 *
 * Tests that sign in twice must not re-read the first (already consumed) link, so the
 * mailbox remembers which message IDs it has already returned.
 */
export function mailbox(email: string) {
  const target = email.toLowerCase();
  const seen = new Set<string>();

  return {
    /** Wait for the next unread message for this address and return its body. */
    async next(timeoutMs = 20_000): Promise<string> {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const { messages } = await fetchJson<{ messages: MessageSummary[] }>(
          '/api/v1/messages?limit=200',
        );

        // Mailpit returns newest first; take the newest one this mailbox has not read.
        const match = messages.find(
          (message) =>
            !seen.has(message.ID) &&
            message.To.some((recipient) => recipient.Address.toLowerCase() === target),
        );

        if (match) {
          seen.add(match.ID);
          const body = await fetchJson<{ HTML: string; Text: string }>(
            `/api/v1/message/${match.ID}`,
          );
          return body.HTML || body.Text;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      throw new Error(`No new email for ${email} arrived within ${timeoutMs}ms`);
    },
  };
}

/** Pull the /auth/confirm URL out of a magic-link email. */
export function signInUrlFrom(emailBody: string): string {
  const match = emailBody.match(/href="([^"]*\/auth\/confirm[^"]*)"/);
  expect(match, 'magic-link email should contain an /auth/confirm link').not.toBeNull();
  return (match as RegExpMatchArray)[1]!.replace(/&amp;/g, '&');
}

/** Pull the 6-digit extension sign-in code out of a magic-link email. */
export function signInCodeFrom(emailBody: string): string {
  const match = emailBody.match(/<strong>(\d{6})<\/strong>/);
  expect(match, 'magic-link email should contain a 6-digit code').not.toBeNull();
  return (match as RegExpMatchArray)[1]!;
}
