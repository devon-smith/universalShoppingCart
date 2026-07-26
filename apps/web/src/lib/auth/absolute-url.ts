/**
 * Build absolute redirect URLs that preserve the host the client actually used.
 *
 * `NextRequest.url` and `NextRequest.nextUrl` are normalized to the server's own origin,
 * so a request to `http://127.0.0.1:3100` can come back as `http://localhost:3100`.
 * Those are different cookie jars: redirecting across them silently drops the session
 * that was just established. The forwarded/Host headers carry the real origin.
 */
export interface RequestLike {
  url: string;
  headers: { get(name: string): string | null };
}

export function requestOrigin(request: RequestLike): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');

  if (!host) {
    return new URL(request.url).origin;
  }

  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto = forwardedProto ?? new URL(request.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}

export function absoluteUrl(path: string, request: RequestLike): string {
  return new URL(path, requestOrigin(request)).toString();
}

export function loginUrl(
  request: RequestLike,
  options: { error?: string; next?: string } = {},
): string {
  const url = new URL('/login', requestOrigin(request));
  if (options.error) url.searchParams.set('error', options.error);
  if (options.next) url.searchParams.set('next', options.next);
  return url.toString();
}
