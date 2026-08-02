#!/usr/bin/env node
/**
 * Serves the extraction fixtures over HTTP for the extension end-to-end suite.
 *
 * The capture flow needs a real `http(s)` page: `chrome.scripting.executeScript` will not
 * touch `about:blank` or a `data:` URL, and pointing the suite at a live retailer would
 * make it non-deterministic and rude (BUILD_PLAN.md §18.5).
 *
 * Deliberately tiny and dependency-free — it exists to hand back six static files.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/extractors/src/fixtures',
);
const port = Number(process.env.FIXTURE_SERVER_PORT ?? 3200);

/**
 * Serve the same product at a different price.
 *
 * The revisit suite needs a page whose price changes between two visits while staying the
 * same product. The fixtures declare an absolute `rel=canonical` on the retailer's own
 * host, so a query string here does not change the fingerprint — the item still matches,
 * which is exactly the case worth testing.
 */
function withPrice(source, price) {
  if (!price || !/^\d+(\.\d{1,2})?$/.test(price)) return source;
  return source.replace(/("price":\s*")[^"]*(")/g, `$1${price}$2`);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
    return;
  }

  // Path traversal guard: resolve, then confirm the result is still inside the directory.
  const requested = resolve(join(fixturesDir, normalize(url.pathname)));
  if (!requested.startsWith(fixturesDir) || extname(requested) !== '.html') {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }

  readFile(requested, 'utf8').then(
    (source) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(withPrice(source, url.searchParams.get('price')));
    },
    () => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    },
  );
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Fixture server on http://127.0.0.1:${port}`);
});
