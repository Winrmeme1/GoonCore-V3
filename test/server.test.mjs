import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createLocalServer } from 'node:http';
import { once } from 'node:events';
import { validatePublicUrl, clientAddress, server } from '../server.mjs';

async function startServer() {
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
  }
  return `http://127.0.0.1:${server.address().port}`;
}
async function closeServer() {
  if (!server.listening) return;
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}

test('proxy accepts a valid public HTTPS URL', () => {
  const address = validatePublicUrl('https://example.com/a?q=x').href;
  assert.equal(address, 'https://example.com/a?q=x');
});

test('proxy refuses malformed URLs, dangerous schemes, credentials, localhost, private IPv4 and private IPv6', () => {
  for (const address of [
    '', 'not a url', 'ftp://example.com', 'file:///etc/passwd', 'gopher://example.com',
    'http://user:password@example.com', 'http://localhost/', 'http://127.0.0.1/',
    'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://192.168.0.5/',
    'http://[::1]/', 'http://[fc00::1]/', 'http://[fe80::1]/', 'http://service.internal/',
    'http://public.example.com:8080/', 'https://example.com:8443/',
  ]) assert.throws(() => validatePublicUrl(address), undefined, address);
});

test('search returns a safe in-app DuckDuckGo destination without redirecting the browser', async (t) => {
  const origin = await startServer();
  t.after(closeServer);
  const response = await fetch(`${origin}/api/search?q=quiet%20web`, { redirect: 'manual' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  const result = await response.json();
  assert.equal(result.engine, 'duckduckgo');
  assert.equal(new URL(result.url).hostname, 'html.duckduckgo.com');
  assert.equal(new URL(result.url).searchParams.get('q'), 'quiet web');
  const bing = await (await fetch(`${origin}/api/search?q=quiet%20web&engine=bing`)).json();
  assert.equal(bing.engine, 'bing');
  assert.equal(new URL(bing.url).hostname, 'www.bing.com');
  const unknown = await (await fetch(`${origin}/api/search?q=quiet%20web&engine=whatever`)).json();
  assert.equal(unknown.engine, 'duckduckgo');
  const unsupported = await fetch(`${origin}/api/proxy`, { method: 'POST' });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET, HEAD');
});

test('health endpoint, static shell and local-address proxy refusal work', async (t) => {
  const origin = await startServer();
  t.after(closeServer);
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /object-src 'none'/);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  const localProxy = await fetch(`${origin}/api/proxy?url=${encodeURIComponent('http://127.0.0.1/latest/meta-data/')}`);
  assert.equal(localProxy.status, 403);
  assert.match((await localProxy.json()).error, /Private and local/);
});

test('the retired movie metadata route is no longer exposed', async (t) => {
  const origin = await startServer();
  t.after(closeServer);
  const response = await fetch(`${origin}/api/movies?q=film`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /API route not found/);
});

test('game catalog route fails clearly when the public manifest is unavailable', async (t) => {
  const origin = await startServer();
  t.after(closeServer);
  const response = await fetch(`${origin}/api/games`);
  assert.ok([200, 502, 504].includes(response.status));
  const data = await response.json();
  if (response.ok) {
    assert.ok(Array.isArray(data.games));
    assert.ok(data.games.length > 0);
    assert.ok(data.games.every((game) => game.gameUrl.startsWith('https://gn-math.github.io/html/')));
    assert.ok(data.games.every((game) => game.cover.startsWith('https://raw.githubusercontent.com/gn-math/covers/main/')));
  } else assert.match(data.error, /catalog|manifest/i);
});

test('rate-limit buckets stay keyed by the socket address unless a trusted proxy header is configured', () => {
  const request = (headers = {}, remoteAddress = '127.0.0.1') => ({ headers, socket: { remoteAddress } });
  // Client-supplied headers must never move a caller into someone else's bucket or into a fresh one.
  assert.equal(clientAddress(request({ 'cf-connecting-ip': '203.0.113.9' })), '127.0.0.1');
  assert.equal(clientAddress(request({ 'x-forwarded-for': '203.0.113.9, 198.51.100.4' })), '127.0.0.1');
  // Behind a tunnel, one proxy address would otherwise be the only bucket every visitor shares.
  assert.equal(clientAddress(request({ 'cf-connecting-ip': '203.0.113.9' }), 'cf-connecting-ip'), '203.0.113.9');
  assert.equal(clientAddress(request({ 'cf-connecting-ip': '203.0.113.9, 10.0.0.1' }), 'cf-connecting-ip'), '203.0.113.9');
  assert.equal(clientAddress(request({ 'cf-connecting-ip': ['198.51.100.7'] }), 'cf-connecting-ip'), '198.51.100.7');
  assert.equal(clientAddress(request({ 'cf-connecting-ip': '::ffff:198.51.100.7' }), 'cf-connecting-ip'), '::ffff:198.51.100.7');
  // Junk in the trusted header degrades to the socket address rather than creating a bucket of its own.
  assert.equal(clientAddress(request({ 'cf-connecting-ip': 'not-an-ip' }), 'cf-connecting-ip'), '127.0.0.1');
  assert.equal(clientAddress(request({}), 'cf-connecting-ip'), '127.0.0.1');
  assert.equal(clientAddress({ headers: {} }), 'unknown');
});

test('independent temporary HTTP servers remain available to the test harness', async (t) => {
  const local = createLocalServer((_req, res) => { res.writeHead(200); res.end('ok'); });
  local.listen(0, '127.0.0.1');
  await once(local, 'listening');
  t.after(() => local.close());
  const response = await fetch(`http://127.0.0.1:${local.address().port}/`);
  assert.equal(await response.text(), 'ok');
});
