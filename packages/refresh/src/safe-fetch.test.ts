import { describe, expect, it, vi } from 'vitest';

import {
  assertSafeUrl,
  isBlockedIp,
  isPublicUnicastIp,
  safeFetch,
  SafeFetchError,
  type SafeFetchReason,
} from './safe-fetch';

describe('isPublicUnicastIp / isBlockedIp', () => {
  it('allows public unicast addresses', () => {
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '2606:2800:220:1:248:1893:25c8:1946',
    ]) {
      expect(isPublicUnicastIp(ip)).toBe(true);
      expect(isBlockedIp(ip)).toBe(false);
    }
  });

  it('blocks loopback, private, link-local, and the cloud-metadata address', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.5.4',
      '192.168.1.1',
      '169.254.169.254', // AWS/GCP metadata
      '0.0.0.0',
      '100.64.0.1', // carrier-grade NAT
    ]) {
      expect(isPublicUnicastIp(ip)).toBe(false);
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it('blocks IPv6 loopback, unique-local, and link-local', () => {
    for (const ip of ['::1', 'fd00::1', 'fe80::1', '::']) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it('unwraps IPv4-mapped IPv6 so a private target cannot hide behind ::ffff:', () => {
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
    expect(isBlockedIp('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('treats an unparseable address as blocked', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});

function reasonOf(fn: () => unknown): SafeFetchReason | 'no-throw' {
  try {
    fn();
  } catch (error) {
    return error instanceof SafeFetchError ? error.reason : 'no-throw';
  }
  return 'no-throw';
}

describe('assertSafeUrl', () => {
  it('accepts a public http(s) URL', () => {
    expect(assertSafeUrl('https://example.com/p').hostname).toBe('example.com');
  });

  it('rejects non-http(s) schemes', () => {
    expect(reasonOf(() => assertSafeUrl('ftp://example.com'))).toBe('blocked_scheme');
    expect(reasonOf(() => assertSafeUrl('file:///etc/passwd'))).toBe('blocked_scheme');
    expect(reasonOf(() => assertSafeUrl('data:text/html,x'))).toBe('blocked_scheme');
  });

  it('rejects a blocked address literal, including bracketed IPv6 and the metadata IP', () => {
    expect(reasonOf(() => assertSafeUrl('http://127.0.0.1/'))).toBe('blocked_address');
    expect(reasonOf(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/'))).toBe(
      'blocked_address',
    );
    expect(reasonOf(() => assertSafeUrl('http://[::1]/'))).toBe('blocked_address');
    expect(reasonOf(() => assertSafeUrl('http://[::ffff:10.0.0.1]/'))).toBe('blocked_address');
  });

  it('rejects localhost names', () => {
    expect(reasonOf(() => assertSafeUrl('http://localhost:3000/'))).toBe('blocked_address');
    expect(reasonOf(() => assertSafeUrl('http://api.localhost/'))).toBe('blocked_address');
  });

  it('allows a public IP literal', () => {
    expect(assertSafeUrl('http://8.8.8.8/').hostname).toBe('8.8.8.8');
  });
});

const publicResolve = async () => ['93.184.216.34'];

describe('safeFetch', () => {
  it('rejects a host that resolves to a private address, before reading anything', async () => {
    const fetchImpl = vi.fn();
    await expect(
      safeFetch(
        'http://intranet.example/',
        {},
        { resolveHost: async () => ['10.0.0.1'], fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: 'blocked_address' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never sends cookie or authorization headers', async () => {
    let sent: Headers | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return new Response('<html>ok</html>', { status: 200 });
    });
    await safeFetch(
      'http://shop.example/p',
      { headers: { cookie: 'session=secret', authorization: 'Bearer t', 'x-trace': 'keep' } },
      { resolveHost: publicResolve, fetchImpl },
    );
    expect(sent?.get('cookie')).toBeNull();
    expect(sent?.get('authorization')).toBeNull();
    expect(sent?.get('x-trace')).toBe('keep');
  });

  it('follows a redirect and re-validates the hop, returning the final body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'http://shop.example/final' } }),
      )
      .mockResolvedValueOnce(new Response('<html>final</html>', { status: 200 }));
    const result = await safeFetch(
      'http://shop.example/start',
      {},
      { resolveHost: publicResolve, fetchImpl },
    );
    expect(result.status).toBe(200);
    expect(result.body).toContain('final');
    expect(result.finalUrl).toBe('http://shop.example/final');
  });

  it('refuses a redirect that points at a blocked address', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/' },
        }),
    );
    await expect(
      safeFetch('http://shop.example/start', {}, { resolveHost: publicResolve, fetchImpl }),
    ).rejects.toMatchObject({ reason: 'blocked_address' });
  });

  it('caps the number of redirects', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://shop.example/next' } }),
    );
    await expect(
      safeFetch(
        'http://shop.example/start',
        { maxRedirects: 1 },
        { resolveHost: publicResolve, fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: 'too_many_redirects' });
  });

  it('aborts a response larger than the byte cap', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'.repeat(5000), { status: 200 }));
    await expect(
      safeFetch(
        'http://shop.example/p',
        { maxBytes: 1000 },
        { resolveHost: publicResolve, fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: 'response_too_large' });
  });

  it('maps a timeout to a timeout error', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    await expect(
      safeFetch(
        'http://shop.example/p',
        { timeoutMs: 10 },
        { resolveHost: publicResolve, fetchImpl },
      ),
    ).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('surfaces a DNS failure', async () => {
    await expect(
      safeFetch(
        'http://nope.example/',
        {},
        {
          resolveHost: async () => {
            throw new Error('ENOTFOUND');
          },
          fetchImpl: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ reason: 'dns_failure' });
  });
});
