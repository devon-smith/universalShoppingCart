import { expect } from '@playwright/test';

/**
 * Minimal Mailpit reader for the local Supabase stack, so the extension suite can pick
 * up the one-time code that the side panel's email sign-in asks for.
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

/** Wait for the newest message addressed to `email` and return its body. */
export async function waitForEmail(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const target = email.toLowerCase();

  while (Date.now() < deadline) {
    const { messages } = await fetchJson<{ messages: MessageSummary[] }>(
      '/api/v1/messages?limit=200',
    );
    const match = messages.find((message) =>
      message.To.some((recipient) => recipient.Address.toLowerCase() === target),
    );

    if (match) {
      const body = await fetchJson<{ HTML: string; Text: string }>(`/api/v1/message/${match.ID}`);
      return body.HTML || body.Text;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`No email for ${email} arrived within ${timeoutMs}ms`);
}

/** Pull the 6-digit sign-in code out of a magic-link email. */
export function signInCodeFrom(emailBody: string): string {
  const match = emailBody.match(/<strong>(\d{6})<\/strong>/);
  expect(match, 'sign-in email should contain a 6-digit code').not.toBeNull();
  return (match as RegExpMatchArray)[1]!;
}
