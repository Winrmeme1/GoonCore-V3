import test from 'node:test';
import assert from 'node:assert/strict';
import { clientRedirectTarget, normalizeGameCatalog, rewriteCss, rewriteHtml, framePolicyError, permitsInlineBootstrap, relayContentSecurityPolicy, searchDestination, server, validatePublicUrl } from '../server.mjs';

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

test('relative HTML, srcset, inline CSS and stylesheets rewrite assets through the local relay', () => {
  const base = new URL('https://public.example/path/index.html');
  const html = rewriteHtml('<html><head></head><body><img src="./photo.png" srcset="./small.png 1x, ./large.png 2x"><a href="../next?x=1">Next</a><div style="background:url(../tile.png)"></div></body></html>', base, 'frame12345678');
  assert.match(html, /\/api\/proxy\?url=https%3A%2F%2Fpublic\.example%2Fpath%2Fphoto\.png&amp;frame=frame12345678/);
  assert.match(html, /\/api\/proxy\?url=https%3A%2F%2Fpublic\.example%2Fnext%3Fx%3D1&amp;frame=frame12345678/);
  assert.match(html, /\/api\/proxy\?url=https%3A%2F%2Fpublic\.example%2Fpath%2Fsmall\.png&amp;frame=frame12345678/);
  assert.match(html, /gooncore:proxy-navigate/);
  const redirected = rewriteHtml('<html><head></head><body></body></html>', new URL('https://public.example/final'), 'frame12345678', true, true);
  assert.match(redirected, /url:base\.href/);
  assert.match(redirected, /gooncore:proxy-redirect/);
  const nestedFrame = rewriteHtml('<html><head></head><body></body></html>', new URL('https://public.example/final'), 'frame12345678');
  assert.match(nestedFrame, /parent\.postMessage/);
  assert.doesNotMatch(nestedFrame, /target\s*=\s*["']_blank/i);
  assert.doesNotMatch(nestedFrame, /gooncore:proxy-redirect/);
  const embeddedFrame = rewriteHtml('<iframe src="https://www.youtube-nocookie.com/embed/abcdef" allowfullscreen></iframe>', base, 'frame12345678');
  assert.match(embeddedFrame, /sandbox="allow-scripts allow-forms"/);
  const nestedSafeFrame = rewriteHtml('<iframe sandbox="allow-scripts allow-popups allow-top-navigation" src="https://assets.example/frame.html"></iframe>', base, 'frame12345678');
  assert.match(nestedSafeFrame, /sandbox="allow-scripts"/);
  assert.doesNotMatch(nestedSafeFrame, /allow-top-navigation|allow-popups/);
  const srcdoc = rewriteHtml('<iframe srcdoc="&lt;img src=&quot;./cover.png&quot;&gt;"></iframe>', base, 'frame12345678');
  assert.match(srcdoc, /srcdoc="&lt;img src=&quot;\/api\/proxy\?url=https%3A%2F%2Fpublic\.example%2Fpath%2Fcover\.png&amp;frame=frame12345678&quot;&gt;"/);
  assert.match(srcdoc, /sandbox="allow-scripts allow-forms"/);
  const css = rewriteCss('a{background:url("../img/a.png")}@import "./theme.css";', base, 'frame12345678');
  assert.match(css, /\/api\/proxy\?url=https%3A%2F%2Fpublic\.example%2Fimg%2Fa\.png&frame=frame12345678/);
  assert.match(css, /\/api\/proxy\?url=https%3A%2F%2Fpublic\.example%2Fpath%2Ftheme\.css&frame=frame12345678/);
});

test('entity-encoded separators in links resolve to real query parameters through the relay', () => {
  const base = new URL('https://html.duckduckgo.com/html/?q=quiet+web');
  const html = rewriteHtml('<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&amp;rut=abc123">Result</a>', base, 'frame12345678');
  assert.match(html, /\/api\/proxy\?url=https%3A%2F%2Fduckduckgo\.com%2Fl%2F%3Fuddg%3Dhttps%253A%252F%252Fexample\.com%252F%26rut%3Dabc123&amp;frame=frame12345678/);
  assert.doesNotMatch(html, /amp%3Brut|%26amp/);
  const srcset = rewriteHtml('<img srcset="//img.example/a.png 1x, //img.example/b.png?v=1&amp;t=2 2x">', base, 'frame12345678');
  assert.match(srcset, /url=https%3A%2F%2Fimg\.example%2Fb\.png%3Fv%3D1%26t%3D2/);
  const refresh = rewriteHtml('<meta http-equiv="refresh" content="0;url=//example.com/go?a=1&amp;b=2">', base, 'frame12345678');
  assert.match(refresh, /url=https%3A%2F%2Fexample\.com%2Fgo%3Fa%3D1%26b%3D2/);
});

test('pure client-side redirect stubs are forwarded, while pages with real content or unsafe targets are not', () => {
  const base = new URL('https://duckduckgo.com/l/?uddg=x');
  const stub = '<html><head><meta name=\'referrer\' content=\'origin\'></head><body><script language=\'JavaScript\'>window.parent.location.replace("https://www.thequietweb.com/");</script><noscript><META http-equiv=\'refresh\' content="0;URL=\'https://www.thequietweb.com/\'"></noscript></body></html>';
  assert.equal(clientRedirectTarget(stub, base)?.href, 'https://www.thequietweb.com/');
  assert.equal(clientRedirectTarget('<html><body><script>location.href="https://example.com/go"</script></body></html>', base)?.href, 'https://example.com/go');
  assert.equal(clientRedirectTarget('<html><body><a href="https://example.com">link</a><script>location.href="https://example.com/go"</script></body></html>', base), null);
  assert.equal(clientRedirectTarget('<html><body><img src="https://example.com/a.png"><script>location.href="https://example.com/go"</script></body></html>', base), null);
  assert.equal(clientRedirectTarget('<html><body><script>location.href="http://127.0.0.1/"</script></body></html>', base), null);
  assert.equal(clientRedirectTarget('<html><body><script>location.href="https://example.com/a"</script><script>location.href="https://example.org/b"</script></body></html>', base), null);
  assert.equal(clientRedirectTarget(`<html><body><!-- ${'x'.repeat(5000)} --><script>location.href="https://example.com/go"</script></body></html>`, base), null);
});

test('inline proxy bootstrap is omitted whenever effective CSP does not explicitly allow it', () => {
  assert.equal(permitsInlineBootstrap([], '<html><head></head></html>'), true);
  assert.equal(permitsInlineBootstrap(["default-src 'self'; script-src 'self' 'unsafe-inline'"], ''), true);
  assert.equal(permitsInlineBootstrap(["script-src 'self'"], ''), false);
  assert.equal(permitsInlineBootstrap(["script-src 'unsafe-inline' 'nonce-abc'"], ''), false);
  assert.equal(permitsInlineBootstrap(["script-src 'unsafe-inline'; script-src-elem 'self'"], ''), false);
  assert.equal(permitsInlineBootstrap([], '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">'), false);
});

test('public URL validation rejects private IPv6 while allowing a global address', () => {
  for (const address of ['http://[fd00::1]/', 'http://[fe80::1]/', 'http://[2001:db8::1]/', 'http://[::ffff:127.0.0.1]/']) {
    assert.throws(() => validatePublicUrl(address), /Private and local/);
  }
  assert.doesNotThrow(() => validatePublicUrl('http://[2606:4700:4700::1111]/'));
  for (const address of ['https://[fc00::1]/', 'https://192.168.1.1/', 'https://service.internal/']) assert.throws(() => validatePublicUrl(address));
});

test('GN Math asset manifest is normalized into trusted individual HTML game and cover URLs', () => {
  const catalog = normalizeGameCatalog([
    { id: 1, name: 'OvO', cover: '{COVER_URL}/1.png', url: '{HTML_URL}/1-fde.html', featured: true },
    { id: -1, name: 'Suggest games', cover: '{COVER_URL}/dc.png', url: 'https://discord.gg/invite' },
    { id: 2, name: 'Untrusted cover', cover: 'https://evil.example/2.png', url: '{HTML_URL}/2.html' },
    { id: 3, name: 'Untrusted game', cover: '{COVER_URL}/3.png', url: 'https://attacker.example/3.html' },
    { id: 1, name: 'Duplicate', cover: '{COVER_URL}/1.png', url: '{HTML_URL}/1.html' },
    { id: 'bad', name: 'Invalid id', cover: '{COVER_URL}/bad.png', url: '{HTML_URL}/bad.html' },
    { id: 5, name: 'Traversal', cover: '{COVER_URL}/%2e%2e/evil.png', url: '{HTML_URL}/5.html' },
    { id: 6, name: 'Traversal game', cover: '{COVER_URL}/6.png', url: '{HTML_URL}/%2e%2e/6.html' },
    { id: 7, name: 'Cross-host cover', cover: 'https://gn-math.github.io/covers/main/7.png', url: '{HTML_URL}/7.html' },
    { id: 8, name: 'Cross-host game', cover: '{COVER_URL}/8.png', url: 'https://raw.githubusercontent.com/gn-math/html/main/8.html' },
  ]);
  assert.equal(catalog.length, 1);
  assert.deepEqual(catalog[0], {
    id: '1', title: 'OvO', cover: 'https://raw.githubusercontent.com/gn-math/covers/main/1.png',
    gameUrl: 'https://gn-math.github.io/html/1-fde.html',
    category: 'Arcade', source: 'GN Math public catalog', featured: true,
  });
  assert.throws(() => normalizeGameCatalog([]), /did not contain/);
  assert.throws(() => normalizeGameCatalog({ games: [] }), /not a JSON array/);
});

test('the embed permission check enforces upstream frame security policies before a cross-origin frame loads', () => {
  const appOrigin = 'https://gooncore.example';
  assert.match(framePolicyError({ 'x-frame-options': 'DENY' }, appOrigin, new URL('https://public.example/')), /X-Frame-Options/);
  assert.match(framePolicyError({ 'x-frame-options': 'SAMEORIGIN' }, appOrigin, new URL('https://public.example/')), /X-Frame-Options/);
  assert.match(framePolicyError({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }, appOrigin, new URL('https://public.example/')), /forbids embedding/);
  assert.equal(framePolicyError({ 'content-security-policy': 'frame-ancestors https://gooncore.example' }, appOrigin, new URL('https://public.example/')), '');
  assert.equal(framePolicyError({ 'content-security-policy': 'frame-ancestors *' }, appOrigin, new URL('https://public.example/')), '');
  assert.match(framePolicyError({ 'content-security-policy': "frame-ancestors 'self'" }, appOrigin, new URL('https://public.example/')), /does not allow/);
});

test('a relayed document keeps upstream restrictions but re-scopes framing to GoonCore itself', () => {
  assert.equal(relayContentSecurityPolicy(''), "frame-ancestors 'self'");
  assert.equal(relayContentSecurityPolicy(undefined), "frame-ancestors 'self'");
  const duckduckgo = relayContentSecurityPolicy("default-src 'none' ; script-src https://duckduckgo.com ; style-src https://duckduckgo.com ; img-src data: https://duckduckgo.com ; frame-ancestors 'self' ; object-src 'none' ; base-uri 'self'");
  assert.equal((duckduckgo.match(/frame-ancestors/g) || []).length, 1);
  assert.match(duckduckgo, /frame-ancestors 'self'/);
  assert.doesNotMatch(duckduckgo, /'none'/);
  assert.match(duckduckgo, /default-src 'self'/);
  assert.match(duckduckgo, /script-src https:\/\/duckduckgo\.com 'self'/);
  assert.match(duckduckgo, /img-src data: https:\/\/duckduckgo\.com 'self'/);
  assert.match(duckduckgo, /base-uri 'self'/);
  const alreadyAllowed = relayContentSecurityPolicy("script-src 'self' https://example.com ; frame-ancestors https://elsewhere.example");
  assert.match(alreadyAllowed, /script-src 'self' https:\/\/example\.com/);
  assert.doesNotMatch(alreadyAllowed, /elsewhere\.example/);
  assert.equal((alreadyAllowed.match(/'self'/g) || []).length, 2);
});

test('the embed-check and proxy routes reject internal targets before making outbound requests', async (t) => {
  const origin = await startServer();
  t.after(closeServer);
  for (const path of ['/api/embed-check', '/api/proxy']) {
    const response = await fetch(`${origin}${path}?url=${encodeURIComponent('http://127.0.0.1/')}`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /Private and local/);
  }
  assert.throws(() => validatePublicUrl('http://192.168.1.1/'), /Private and local/);
  assert.throws(() => validatePublicUrl('http://255.255.255.255/'), /Private and local/);
});

test('search returns a same-origin API result containing a safe HTTPS destination', async (t) => {
  const origin = await startServer();
  t.after(closeServer);
  const response = await fetch(`${origin}/api/search?q=${encodeURIComponent('quiet web')}&region=uk-en&safeSearch=strict`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
  const data = await response.json();
  const url = new URL(data.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'html.duckduckgo.com');
  assert.equal(url.searchParams.get('q'), 'quiet web');
  assert.equal(url.searchParams.get('kl'), 'uk-en');
  assert.equal(url.searchParams.get('kp'), '1');
});
