import ipaddr from 'ipaddr.js';

/**
 * SSRF-safe server-side fetch (BUILD_PLAN.md §17.3).
 *
 * A background refresh fetches URLs derived from user-saved data, so the fetcher is an SSRF
 * primitive unless it is boxed in. Every rule from §17.3 lives here: http/https only; the target
 * host must resolve to a public unicast address (loopback, private, link-local — including the
 * `169.254.169.254` cloud-metadata endpoint — and their IPv6/IPv4-mapped forms are refused);
 * redirects are followed manually and each hop is re-validated; response size, redirect count,
 * and time are all capped; and cookies and authorization headers are never sent.
 *
 * The IP classification uses `ipaddr.js` rather than hand-rolled range checks — IPv6 and
 * IPv4-mapped parsing is exactly where an SSRF filter grows a hole (DECISIONS.md, 2026-08-03).
 * The DNS resolver and fetch implementation are injectable so the redirect/size/timeout
 * orchestration is unit-testable without a network; the real-network behaviour is the local
 * host's live check.
 */

export type SafeFetchReason =
  | 'invalid_url'
  | 'blocked_scheme'
  | 'blocked_address'
  | 'dns_failure'
  | 'too_many_redirects'
  | 'missing_location'
  | 'response_too_large'
  | 'timeout'
  | 'network_error';

export class SafeFetchError extends Error {
  readonly reason: SafeFetchReason;
  constructor(reason: SafeFetchReason, message: string) {
    super(message);
    this.name = 'SafeFetchError';
    this.reason = reason;
  }
}

/** True only for a public unicast address — the one category a server-side fetch may target. */
export function isPublicUnicastIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  // Unwrap an IPv4-mapped IPv6 address (e.g. ::ffff:169.254.169.254) before ranging it, or the
  // embedded private/link-local target would hide behind an "ipv4Mapped" classification.
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  return addr.range() === 'unicast';
}

/** The inverse, named for the call sites that read better as a rejection. */
export function isBlockedIp(ip: string): boolean {
  return !isPublicUnicastIp(ip);
}

const IPV6_BRACKETS = /^\[(.+)\]$/;

/** A hostname that is a localhost name rather than an address literal. */
function isLocalhostName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost');
}

/**
 * Validate a URL's scheme and, when the host is an address literal, the address — before any DNS
 * lookup. Returns the parsed URL or throws {@link SafeFetchError}. A hostname that is a name
 * (not a literal) still has to clear DNS resolution in {@link safeFetch}.
 */
export function assertSafeUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError('invalid_url', `Not a valid URL: ${String(input)}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('blocked_scheme', `Only http and https are allowed: ${url.protocol}`);
  }

  const literal = url.hostname.replace(IPV6_BRACKETS, '$1');
  if (ipaddr.isValid(literal)) {
    if (!isPublicUnicastIp(literal)) {
      throw new SafeFetchError('blocked_address', `Address is not public: ${literal}`);
    }
  } else if (isLocalhostName(url.hostname)) {
    throw new SafeFetchError('blocked_address', `Host is not public: ${url.hostname}`);
  }

  return url;
}

export interface SafeFetchOptions {
  /** Cap on redirects followed. Default 3. */
  maxRedirects?: number;
  /** Cap on response bytes read before aborting. Default 3 MiB. */
  maxBytes?: number;
  /** Overall deadline in milliseconds. Default 10 000. */
  timeoutMs?: number;
  /** Extra request headers. `cookie` and `authorization` are stripped regardless. */
  headers?: Record<string, string>;
}

export interface SafeFetchDeps {
  /** Resolve a hostname to its IP addresses. Defaults to `dns.lookup(host, { all: true })`. */
  resolveHost?: (hostname: string) => Promise<string[]>;
  /** The fetch implementation. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export interface SafeFetchResult {
  status: number;
  finalUrl: string;
  headers: Headers;
  body: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 3;
// 3 MiB. Modern commerce pages routinely run 1–3 MB of HTML; a smaller cap turns "large page"
// into a fetch failure, and repeated failures back a domain off and eventually disable it — so a
// too-tight cap would mark big-but-fine retailers dead.
const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const { lookup } = await import('node:dns/promises');
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
}

/** Build the request headers, dropping anything that would leak the caller's identity. */
function safeHeaders(headers: Record<string, string> | undefined): Headers {
  const result = new Headers();
  result.set('accept', 'text/html,application/xhtml+xml');
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (lower === 'cookie' || lower === 'authorization') continue;
    result.set(name, value);
  }
  return result;
}

/** Confirm every address a hostname resolves to is public unicast. Address literals are already
 * checked in {@link assertSafeUrl}, so this only runs DNS for real names. */
async function assertHostResolvesPublic(
  url: URL,
  resolveHost: (hostname: string) => Promise<string[]>,
): Promise<void> {
  const literal = url.hostname.replace(IPV6_BRACKETS, '$1');
  if (ipaddr.isValid(literal)) return; // already validated as a literal

  let addresses: string[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new SafeFetchError('dns_failure', `Could not resolve ${url.hostname}`);
  }
  if (addresses.length === 0) {
    throw new SafeFetchError('dns_failure', `No addresses for ${url.hostname}`);
  }
  for (const address of addresses) {
    if (!isPublicUnicastIp(address)) {
      throw new SafeFetchError('blocked_address', `${url.hostname} resolves to ${address}`);
    }
  }
}

/** Read a response body, aborting past `maxBytes` so a huge or endless response cannot exhaust
 * memory (Content-Length is advisory, so the stream itself is metered). */
async function readCappedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError('response_too_large', `Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Fetch a URL under the SSRF rules above. Follows redirects manually, re-validating scheme,
 * literal address, and resolved addresses at every hop, and returns the final response's status,
 * URL, headers, and size-capped body text.
 */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
  deps: SafeFetchDeps = {},
): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolveHost = deps.resolveHost ?? defaultResolveHost;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url = assertSafeUrl(input);

    for (let redirects = 0; ; redirects += 1) {
      await assertHostResolvesPublic(url, resolveHost);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: safeHeaders(options.headers),
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new SafeFetchError('timeout', `Request to ${url.hostname} timed out`);
        }
        throw new SafeFetchError('network_error', `Request failed: ${String(error)}`);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects >= maxRedirects) {
          throw new SafeFetchError('too_many_redirects', `More than ${maxRedirects} redirects`);
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new SafeFetchError('missing_location', 'Redirect without a Location header');
        }
        // Resolve relative redirects against the current URL, then re-validate the target — a
        // redirect to http://169.254.169.254 must be caught exactly like a direct request.
        url = assertSafeUrl(new URL(location, url).toString());
        continue;
      }

      const body = await readCappedBody(response, maxBytes);
      return { status: response.status, finalUrl: url.toString(), headers: response.headers, body };
    }
  } finally {
    clearTimeout(timer);
  }
}
