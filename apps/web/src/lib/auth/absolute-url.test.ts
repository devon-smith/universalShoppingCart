import { describe, expect, it } from 'vitest';

import type { RequestLike } from './absolute-url';
import { absoluteUrl, loginUrl, requestOrigin } from './absolute-url';

function request(url: string, headers: Record<string, string> = {}): RequestLike {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    url,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
  };
}

describe('requestOrigin', () => {
  it('prefers the Host header over the normalized request URL', () => {
    // Next normalizes `request.url` to localhost even when the client used 127.0.0.1;
    // following it would move the session to a different cookie jar.
    expect(
      requestOrigin(request('http://localhost:3100/auth/confirm', { host: '127.0.0.1:3100' })),
    ).toBe('http://127.0.0.1:3100');
  });

  it('honours a proxy forwarding the original host and scheme', () => {
    expect(
      requestOrigin(
        request('http://localhost:3000/auth/callback', {
          'x-forwarded-host': 'cart.example.com',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://cart.example.com');
  });

  it('falls back to the request URL when no host header is present', () => {
    expect(requestOrigin(request('https://cart.example.com/auth/callback'))).toBe(
      'https://cart.example.com',
    );
  });
});

describe('absoluteUrl', () => {
  it('resolves a path against the client-visible origin', () => {
    expect(
      absoluteUrl(
        '/app',
        request('http://localhost:3100/auth/confirm', { host: '127.0.0.1:3100' }),
      ),
    ).toBe('http://127.0.0.1:3100/app');
  });

  it('preserves a query string on the target path', () => {
    expect(absoluteUrl('/app?view=cards', request('https://cart.example.com/auth/callback'))).toBe(
      'https://cart.example.com/app?view=cards',
    );
  });
});

describe('loginUrl', () => {
  it('encodes the error and the return path', () => {
    const url = new URL(
      loginUrl(request('https://cart.example.com/auth/confirm'), {
        error: 'Token has expired or is invalid',
        next: '/app',
      }),
    );

    expect(url.origin).toBe('https://cart.example.com');
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('error')).toBe('Token has expired or is invalid');
    expect(url.searchParams.get('next')).toBe('/app');
  });

  it('omits absent parameters', () => {
    expect(loginUrl(request('https://cart.example.com/auth/callback'))).toBe(
      'https://cart.example.com/login',
    );
  });
});
