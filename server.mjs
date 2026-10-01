import { createServer, request as httpRequest } from 'node:http';
import { createReadStream } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WEBROOT = join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT || '4173', 10);
// Behind a tunnel or reverse proxy every request reaches the process from the proxy's own loopback
// address, which would collapse every visitor into one rate-limit bucket. Name the header your proxy
// injects (Cloudflare Tunnel: TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip) only when the server cannot
// be reached directly, because a directly reachable caller could otherwise rotate the header to reset
// its own bucket.
const TRUSTED_CLIENT_IP_HEADER = (process.env.TRUSTED_CLIENT_IP_HEADER || '').trim().toLowerCase();
const API_LIMIT = 90;
// A single relayed page can legitimately request hundreds of subresources, so the proxy bucket is much
// larger than the API bucket. Each bucket counts separately: heavy browsing must never start refusing
// searches.
const PROXY_LIMIT = 900;
const RATE_WINDOW_MS = 60_000;
const BODY_LIMIT = 1_048_576;
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid', '.example'];
const MIME = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const requests = new Map();
const GAME_MANIFEST_URL = 'https://raw.githubusercontent.com/gn-math/assets/main/zones.json';
const GAME_CATALOG_TIMEOUT_MS = 12_000;
// jsDelivr blocks the whole `gn-math` GitHub user (HTTP 403, acceptable-use policy), so the catalog is
// served from GitHub's own infrastructure instead: org Pages for the individual games (correct
// text/html content type, no frame headers) and raw content for the cover artwork.
const GAME_COVER_BASE = 'https://raw.githubusercontent.com/gn-math/covers/main';
const GAME_HTML_BASE = 'https://gn-math.github.io/html';
const GAME_CATALOG_MAX_AGE = 6 * 60 * 60 * 1000;
const GAME_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
// Browsers identify themselves, and many sites answer generic crawler-style agents with bot challenges
// instead of the page a human asked for. The relay therefore carries the requesting browser's own
// user-agent (falling back to a common desktop browser string when there is none or it looks unsafe).
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
function clientUserAgent(req) {
  const value = String(req.headers['user-agent'] || '').trim();
  return value && value.length <= 400 && !/[\r\n\0]/.test(value) ? value : BROWSER_USER_AGENT;
}
let gameCatalogCache = null;
let gameCatalogPending = null;

function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function scriptJson(value) {
  return JSON.stringify(String(value)).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function validFrameId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value) ? value : '';
}

function proxyError(res, status, message, frameId = '') {
  if (!frameId) { json(res, status, { error: message }); return; }
  const title = 'This page could not be opened in GoonCore';
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GoonCore · page unavailable</title><style>html,body{min-height:100%;margin:0;background:#08090a;color:#eee;font:14px/1.65 system-ui,sans-serif}body{display:grid;place-items:center;padding:24px;box-sizing:border-box}main{max-width:460px;text-align:center}h1{font-size:17px;font-weight:550}p{color:#aaa;font-size:13px}</style><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>GoonCore respects the destination’s security policy and only relays supported public pages.</p></main><script>parent.postMessage({type:'gooncore:proxy-error',id:${scriptJson(frameId)},title:${scriptJson(title)},message:${scriptJson(message)}},'*')</script></html>`;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'; sandbox allow-scripts",
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

// Every engine is described by its own endpoint and its own spelling of the locale and safe-search
// preferences, so the client only ever asks for "engine + query + preferences" and receives one safe
// same-origin destination to relay. DuckDuckGo's HTML endpoint stays the default.
const SEARCH_ENGINES = {
  duckduckgo: {
    endpoint: 'https://html.duckduckgo.com/html/',
    apply: (destination, { query, region, safeSearch }) => {
      destination.searchParams.set('q', query);
      if (region) destination.searchParams.set('kl', region);
      if (safeSearch === 'strict') destination.searchParams.set('kp', '1');
      if (safeSearch === 'off') destination.searchParams.set('kp', '-2');
    },
  },
  google: {
    endpoint: 'https://www.google.com/search',
    apply: (destination, { query, region, safeSearch }) => {
      destination.searchParams.set('q', query);
      const [country, language] = splitRegion(region);
      if (language) destination.searchParams.set('hl', language);
      if (country) destination.searchParams.set('gl', country);
      if (safeSearch === 'strict') destination.searchParams.set('safe', 'active');
      if (safeSearch === 'off') destination.searchParams.set('safe', 'off');
    },
  },
  bing: {
    endpoint: 'https://www.bing.com/search',
    apply: (destination, { query, region, safeSearch }) => {
      destination.searchParams.set('q', query);
      const [country, language] = splitRegion(region);
      if (language) destination.searchParams.set('setlang', language);
      if (country) destination.searchParams.set('cc', country);
      if (safeSearch === 'strict') destination.searchParams.set('adlt', 'strict');
      if (safeSearch === 'off') destination.searchParams.set('adlt', 'off');
    },
  },
  brave: {
    endpoint: 'https://search.brave.com/search',
    apply: (destination, { query, region, safeSearch }) => {
      destination.searchParams.set('q', query);
      destination.searchParams.set('source', 'web');
      const [country] = splitRegion(region);
      if (country) destination.searchParams.set('country', country);
      if (safeSearch === 'strict') destination.searchParams.set('safesearch', 'strict');
      if (safeSearch === 'off') destination.searchParams.set('safesearch', 'off');
    },
  },
};

function splitRegion(region) {
  const [country = '', language = ''] = String(region || '').split('-');
  return [country, language];
}

export function searchDestination(query, region = '', safeSearch = 'moderate', engine = 'duckduckgo') {
  const chosen = SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo;
  const destination = new URL(chosen.endpoint);
  chosen.apply(destination, {
    query: String(query).trim().slice(0, 512),
    region: String(region).slice(0, 12),
    safeSearch: ['moderate', 'strict', 'off'].includes(safeSearch) ? safeSearch : 'moderate',
  });
  return destination.href;
}

function handleSearch(res, requestUrl) {
  const query = (requestUrl.searchParams.get('q') || '').trim();
  if (!query || query.length > 512) { json(res, 400, { error: 'Enter a search query under 513 characters.' }); return; }
  const regions = new Set(['us-en', 'uk-en', 'ca-en', 'au-en', 'nz-en', 'ie-en', 'de-de', 'fr-fr', 'es-es', 'mx-es', 'nl-nl', 'br-pt', 'jp-jp', 'kr-kr', 'in-en']);
  const region = requestUrl.searchParams.get('region') || '';
  const safeSearch = requestUrl.searchParams.get('safeSearch') || 'moderate';
  const requested = requestUrl.searchParams.get('engine') || 'duckduckgo';
  const engine = Object.hasOwn(SEARCH_ENGINES, requested) ? requested : 'duckduckgo';
  json(res, 200, { url: searchDestination(query, regions.has(region) ? region : '', safeSearch, engine), engine });
}

// Buckets are keyed by the socket address unless a trusted proxy header is configured. Only a real IP
// literal is accepted from that header, so a malformed or junk value falls back to the socket address
// instead of minting an unlimited number of buckets or letting one caller impersonate another.
function clientAddress(req, trustedHeader = TRUSTED_CLIENT_IP_HEADER) {
  if (trustedHeader) {
    const header = req.headers?.[trustedHeader];
    const value = String(Array.isArray(header) ? header[0] : header || '').split(',')[0].trim();
    if (isIP(value)) return value.toLowerCase();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function rateLimit(req, res, limit = API_LIMIT) {
  const address = `${limit}:${clientAddress(req)}`;
  const now = Date.now();
  let state = requests.get(address);
  if (!state || state.until <= now) {
    state = { count: 0, until: now + RATE_WINDOW_MS };
    requests.set(address, state);
  }
  state.count += 1;
  if (requests.size > 10_000) {
    for (const [key, entry] of requests) if (entry.until <= now) requests.delete(key);
    while (requests.size > 10_000) requests.delete(requests.keys().next().value);
  }
  if (state.count <= limit) return true;
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((state.until - now) / 1000))));
  json(res, 429, { error: 'Too many requests. Please wait a minute and try again.' });
  return false;
}

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  const d = parts[3];
  const globallyRoutable = a >= 1 && a <= 223 && ![10, 127].includes(a);
  const specialUse = a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127
    || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && (b === 0 && (c === 0 || c === 2) || b === 88 && c === 99 || b === 168 || b === 31 && c === 196 || b === 52 && c === 193 || b === 175 && c === 48 || b === 51 && c === 100)
    || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
    || a === 203 && b === 0 && c === 113
    || a >= 224 || a === 255 && d === 255;
  return specialUse || !globallyRoutable;
}

function isPrivateIPv6(address) {
  const ip = address.toLowerCase().split('%')[0];
  if (ip.startsWith('::ffff:')) return isPrivateAddress(ip.slice(7));
  const parts = ip.split('::');
  const groups = (parts[0] + ':' + (parts[1] || '')).split(':').filter(Boolean);
  const first = Number.parseInt(groups[0] || '0', 16);
  const second = Number.parseInt(groups[1] || '0', 16);
  if (ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || /^fe[89ab]/.test(ip) || ip.startsWith('ff')) return true;
  if (first === 0x2002 || first === 0x3fff || first === 0x2001 && (second <= 0x01ff || second === 0x0010 || second === 0x0020 || second === 0x0db8)) return true;
  return first < 0x2000 || first > 0x3fff;
}

function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 0) return true;
  return family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
}

export function validatePublicUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Enter a valid HTTP or HTTPS address.');
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a complete address, such as https://example.com.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Only public HTTP and HTTPS addresses are supported.');
  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) throw new Error('For safety, only standard public HTTP and HTTPS ports are available.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix)) || host === 'metadata.google.internal') throw new Error('This address cannot be reached through the proxy.');
  if (isIP(host) && isPrivateAddress(host)) throw new Error('Private and local network addresses are blocked.');
  return url;
}

async function validateResolvedHost(url, signal) {
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (signal?.aborted) throw Object.assign(new Error('The outbound request timed out.'), { name: 'AbortError' });
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('Private and local network addresses are blocked.');
    return [{ address: host, family: isIP(host) }];
  }
  let timeout;
  try {
    let abortDns;
    const addresses = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('DNS lookup timed out.')), 4000); }),
      ...(signal ? [new Promise((_, reject) => { abortDns = () => reject(Object.assign(new Error('The outbound request timed out.'), { name: 'AbortError' })); signal.addEventListener('abort', abortDns, { once: true }); })] : []),
    ]).finally(() => { if (abortDns) signal.removeEventListener('abort', abortDns); });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('This address resolves to a private or local network.');
    if (!addresses.some(({ family }) => family === 4 || family === 6)) throw new Error('The website did not resolve to a usable public IP address.');
    return addresses;
  } catch (error) {
    if (/Private|local network|timed out/.test(error.message)) throw error;
    throw new Error('The website could not be found. Check the address and try again.');
  } finally { clearTimeout(timeout); }
}

function requestPinned(url, addresses, accept, range = '', method = 'GET', signal, userAgent = BROWSER_USER_AGENT) {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const options = {
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      method,
      path: `${url.pathname}${url.search}`,
      agent: false,
      headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Encoding': 'identity', Connection: 'close', ...(range ? { Range: range } : {}) },
      lookup: (_name, lookupOptions, callback) => {
        const matches = lookupOptions?.family ? addresses.filter(({ family }) => family === lookupOptions.family) : addresses;
        if (!matches.length) return callback(new Error('No public IP address available.'));
        if (lookupOptions?.all) return callback(null, matches);
        callback(null, matches[0].address, matches[0].family);
      },
    };
    let request;
    const deadline = setTimeout(() => {
      const timeout = new Error('The website request timed out.');
      timeout.name = 'AbortError';
      request?.destroy(timeout);
    }, 10_000);
    const abortRequest = () => request?.destroy(Object.assign(new Error('The outbound request timed out.'), { name: 'AbortError' }));
    const cleanup = () => { clearTimeout(deadline); signal?.removeEventListener('abort', abortRequest); };
    if (signal?.aborted) { cleanup(); reject(Object.assign(new Error('The outbound request timed out.'), { name: 'AbortError' })); return; }
    signal?.addEventListener('abort', abortRequest, { once: true });
    deadline.unref?.();
    request = transport(options, (response) => {
      response.once('end', cleanup);
      response.once('close', cleanup);
      response.once('aborted', cleanup);
      response.once('error', (error) => { cleanup(); reject(error); });
      resolve(response);
    });
    request.setTimeout(10_000, () => {
      const timeout = new Error('The website request timed out.');
      timeout.name = 'AbortError';
      request.destroy(timeout);
    });
    request.once('error', (error) => { cleanup(); reject(error); });
    request.end();
  });
}

async function collectLimited(response, limit = BODY_LIMIT) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response) {
    total += chunk.length;
    if (total > limit) {
      response.destroy();
      throw new Error(`This response exceeds the ${Math.round(limit / 1_048_576)} MB limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function proxyPath(url, frameId = '') {
  const params = new URLSearchParams({ url: url.href });
  if (frameId) params.set('frame', frameId);
  return `/api/proxy?${params}`;
}
function escapeAttribute(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Attribute values arrive with HTML entities intact, but the browser decodes them before resolving a
// URL. `href="//site/l/?uddg=x&amp;rut=y"` must resolve to `...?uddg=x&rut=y`, otherwise the entity
// ends up inside our relay URL and the destination sees a broken query string (HTTP 400).
function decodeAttributeValue(value) {
  return String(value).replace(/&#x26;|&#38;|&amp;/gi, '&');
}
function sandboxIframe(attributes) {
  const sandbox = attributes.match(/\bsandbox(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/i);
  const allowed = new Set(['allow-scripts', 'allow-forms', 'allow-pointer-lock', 'allow-orientation-lock', 'allow-presentation']);
  const grants = sandbox ? String(sandbox[1] ?? sandbox[2] ?? sandbox[3] ?? '').toLowerCase().split(/\s+/).filter((token) => allowed.has(token)) : ['allow-scripts', 'allow-forms'];
  const remaining = sandbox ? attributes.replace(sandbox[0], '') : attributes;
  return `<iframe${remaining} sandbox="${[...new Set(grants)].join(' ')}">`;
}
function rewriteSrcdoc(value, base, frameId) {
  let srcdoc = String(value).replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&').replace(/<base\b[^>]*>/gi, '');
  srcdoc = srcdoc.replace(/\b(src|href|poster|action|formaction|data-src|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (_match, name, doubleQuoted, singleQuoted, bare) => {
      const reference = doubleQuoted ?? singleQuoted ?? bare;
      if (!reference || /^(?:data:|blob:|mailto:|tel:|javascript:|about:|sms:|#)/i.test(reference)) return `${name}="${escapeAttribute(reference)}"`;
      try {
        const destination = new URL(reference, base);
        return ['http:', 'https:'].includes(destination.protocol) ? `${name}="${proxyPath(destination, frameId)}"` : `${name}="${reference}"`;
      } catch { return `${name}="${reference}"`; }
    });
  srcdoc = srcdoc.replace(/\b(target|formtarget)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_match, name) => `${name}="_self"`);
  return srcdoc.replace(/<iframe\b([^>]*)>/gi, (_tag, attributes) => sandboxIframe(attributes));
}

export function rewriteCss(css, base, frameId = '') {
  return css.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, quote, reference) => {
    const value = reference.trim();
    if (!value || /^(?:data:|blob:|#)/i.test(value)) return match;
    try { const resource = new URL(value, base); if (['http:', 'https:'].includes(resource.protocol)) return `url("${proxyPath(resource, frameId)}")`; } catch {}
    return match;
  }).replace(/@import\s+(["'])(.*?)\1/gi, (match, quote, reference) => {
    try { const resource = new URL(reference, base); if (['http:', 'https:'].includes(resource.protocol)) return `@import url("${proxyPath(resource, frameId)}")`; } catch {}
    return match;
  });
}

function rewriteSrcset(value, base, frameId) {
  return value.split(/,(?![^()]*\))/).map((candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed || /^data:/i.test(trimmed)) return trimmed;
    const separator = trimmed.search(/\s/);
    const reference = decodeAttributeValue(separator < 0 ? trimmed : trimmed.slice(0, separator));
    const descriptor = separator < 0 ? '' : trimmed.slice(separator);
    try {
      const resource = new URL(reference, base);
      if (['http:', 'https:'].includes(resource.protocol)) return `${proxyPath(resource, frameId)}${descriptor}`;
    } catch {}
    return trimmed;
  }).join(', ');
}

export function rewriteHtml(html, base, frameId = '', injectNavigation = true, reportRedirect = false) {
  const proxyValue = (reference) => {
    const value = decodeAttributeValue(reference).trim();
    if (!value || value.startsWith('#') || /^(?:data:|blob:|mailto:|tel:|javascript:|about:|sms:)/i.test(value)) return reference;
    try {
      const destination = new URL(value, base);
      return ['http:', 'https:'].includes(destination.protocol) ? proxyPath(destination, frameId) : reference;
    } catch { return reference; }
  };
  let result = html.replace(/<base\b[^>]*>/gi, '');
  const srcdocValues = [];
  result = result.replace(/\bsrcdoc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (_match, doubleQuoted, singleQuoted) => {
    const index = srcdocValues.push(escapeAttribute(rewriteSrcdoc(doubleQuoted ?? singleQuoted ?? '', base, frameId))) - 1;
    return `srcdoc="__GOONCORE_SRCDOC_${index}__"`;
  });
  const quotedOrBare = /\b(src|href|poster|action|formaction|data-src|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  result = result.replace(quotedOrBare, (match, name, doubleQuoted, singleQuoted, bare) => `${name}="${escapeAttribute(proxyValue(doubleQuoted ?? singleQuoted ?? bare))}"`);
  result = result.replace(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, doubleQuoted, singleQuoted, bare) => `srcset="${escapeAttribute(rewriteSrcset(doubleQuoted ?? singleQuoted ?? bare, base, frameId))}"`);
  result = result.replace(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, doubleQuoted, singleQuoted, bare) => `style="${escapeAttribute(rewriteCss(doubleQuoted ?? singleQuoted ?? bare, base, frameId))}"`);
  result = result.replace(/\b(target|formtarget)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_match, name) => `${name}="_self"`);
  result = result.replace(/\bsrc\s*=\s*(["'])\/\/([^"']+)\1/gi, (_match, quote, host) => `src=${quote}${proxyValue(`https://${host}`)}${quote}`);
  result = result.replace(/<iframe\b([^>]*)>/gi, (_tag, attributes) => sandboxIframe(attributes));
  srcdocValues.forEach((value, index) => { result = result.replace(`__GOONCORE_SRCDOC_${index}__`, value); });
  result = result.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/\bhttp-equiv\s*=\s*["']?refresh/i.test(tag)) return tag;
    return tag.replace(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i, (match, doubleQuoted, singleQuoted, bare) => {
      const value = decodeAttributeValue(doubleQuoted ?? singleQuoted ?? bare);
      return `content="${escapeAttribute(value.replace(/(\burl\s*=\s*)(["']?)([^;\s"']+)\2/i, (all, prefix, quote, destination) => `${prefix}"${proxyValue(destination)}"`))}"`;
    });
  });
  if (!injectNavigation || !frameId) return result;
  const upstreamBase = scriptJson(base.href);
  const token = scriptJson(frameId);
  const redirectReport = reportRedirect ? `parent.postMessage({type:'gooncore:proxy-redirect',id,url:base.href},'*');` : '';
  const bootstrap = `<script>(()=>{const base=new URL(${upstreamBase}),id=${token};${redirectReport}const relay=url=>{const params=new URLSearchParams({url:url.href,frame:id});return '/api/proxy?'+params};const visit=url=>{parent.postMessage({type:'gooncore:proxy-navigate',id,url:url.href},'*');location.href=relay(url)};document.addEventListener('click',event=>{if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const anchor=event.target.closest&&event.target.closest('a[href]');if(!anchor||anchor.hasAttribute('download'))return;const raw=anchor.getAttribute('href');if(!raw||/^(?:#|mailto:|tel:|javascript:|data:|blob:|sms:)/i.test(raw))return;let target;try{const local=new URL(raw,location.href);if(local.origin===location.origin&&local.pathname==='/api/proxy'&&local.searchParams.has('url'))target=new URL(local.searchParams.get('url'));else target=new URL(raw,base)}catch{return}if(!/^https?:$/.test(target.protocol))return;event.preventDefault();visit(target)},true);document.addEventListener('submit',event=>{const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();if(form.method.toLowerCase()!=='get'){parent.postMessage({type:'gooncore:proxy-error',id,title:'This form is not supported',message:'For safety, GoonCore only forwards simple GET forms. Sign-in, payment, and POST forms are not sent.'},'*');return}let target;try{const raw=form.getAttribute('action')||base.href,local=new URL(raw,location.href);target=local.origin===location.origin&&local.pathname==='/api/proxy'&&local.searchParams.has('url')?new URL(local.searchParams.get('url')):new URL(raw,base)}catch{return}for(const[key,value]of new FormData(form))target.searchParams.append(key,String(value));visit(target)},true)})()</script>`;
  if (/<head(?:\s[^>]*)?>/i.test(result)) return result.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${bootstrap}`);
  return `${bootstrap}${result}`;
}

export function framePolicyError(headers, parentOrigin, providerUrl) {
  const xFrameOptions = String(headers['x-frame-options'] || '').trim();
  if (xFrameOptions) {
    const value = xFrameOptions.toLowerCase();
    if (value === 'sameorigin') {
      try { if (parentOrigin && new URL(parentOrigin).origin === providerUrl.origin) return ''; } catch {}
    }
    return `This site sets X-Frame-Options (${xFrameOptions}) and does not permit GoonCore to embed it.`;
  }
  const raw = headers['content-security-policy'];
  const policies = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((value) => String(value).split(/,\s*(?=[a-z-]+\s)/i));
  for (const policy of policies) {
    const directive = policy.split(';').map((part) => part.trim()).find((part) => /^frame-ancestors(?:\s|$)/i.test(part));
    if (!directive) continue;
    const sources = directive.replace(/^frame-ancestors\s*/i, '').trim().split(/\s+/).filter(Boolean);
    if (!sources.length || sources.includes("'none'")) return 'This site’s Content-Security-Policy forbids embedding.';
    let app;
    try { app = parentOrigin ? new URL(parentOrigin) : null; } catch { app = null; }
    const allowed = sources.some((source) => {
      if (source === '*') return true;
      if (source === "'self'") return Boolean(app && app.origin === providerUrl.origin);
      if (source === 'https:') return Boolean(app && app.protocol === 'https:');
      if (source === 'http:') return Boolean(app && app.protocol === 'http:');
      const match = source.match(/^(https?):\/\/(\*\.)?([^/:]+)(?::(\d+|\*))?(?:\/.*)?$/i);
      if (!match || !app) return false;
      const [, scheme, wildcard, hostname, port] = match;
      const host = hostname.toLowerCase();
      const appHost = app.hostname.toLowerCase();
      const domainMatches = wildcard ? appHost.endsWith(`.${host}`) && appHost !== host : appHost === host;
      const portMatches = !port || port === '*' || Number(port) === Number(app.port || (app.protocol === 'https:' ? 443 : 80));
      return app.protocol === `${scheme.toLowerCase()}:` && domainMatches && portMatches;
    });
    if (!allowed) return 'This site’s Content-Security-Policy frame-ancestors directive does not allow GoonCore to embed it.';
  }
  return '';
}

// A relayed document is re-served from GoonCore's own origin with every asset URL rewritten to
// /api/proxy, so the upstream policy cannot be replayed verbatim: its origin lists no longer match
// the same-origin copies and its frame-ancestors list would forbid GoonCore from showing the relay at
// all. Translate it instead — keep every upstream restriction, allow the rewritten same-origin
// resources, and re-scope framing to GoonCore itself (the document still runs inside a sandboxed frame).
const RELAY_FETCH_DIRECTIVES = /^(?:default-src|script-src(?:-elem|-attr)?|style-src(?:-elem|-attr)?|img-src|font-src|media-src|object-src|frame-src|child-src|worker-src|manifest-src|prefetch-src)$/i;

export function relayContentSecurityPolicy(value) {
  const policies = (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((entry) => String(entry).split(/,\s*(?=[a-z-]+\s)/i))
    .map((policy) => policy.trim())
    .filter(Boolean);
  const translated = policies.map((policy) => {
    const directives = [];
    for (const part of policy.split(';').map((piece) => piece.trim()).filter(Boolean)) {
      const name = part.split(/\s+/)[0];
      if (/^frame-ancestors$/i.test(name)) continue;
      if (RELAY_FETCH_DIRECTIVES.test(name)) {
        const sources = part.split(/\s+/).slice(1);
        if (sources.some((source) => source.toLowerCase() === "'self'")) directives.push(part);
        else directives.push(`${name} ${sources.filter((source) => source.toLowerCase() !== "'none'").concat("'self'").join(' ')}`);
        continue;
      }
      directives.push(part);
    }
    directives.push("frame-ancestors 'self'");
    return directives.join('; ');
  });
  return translated.length ? translated.join(', ') : "frame-ancestors 'self'";
}

function metaCspPolicies(html) {
  const policies = [];
  for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const equivMatch = tag.match(/\bhttp-equiv\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!equivMatch) continue;
    const equiv = String(equivMatch[1] ?? equivMatch[2] ?? equivMatch[3]).trim();
    if (/&(?:#x?[\da-f]+|[a-z][a-z\d]+);/i.test(equiv)) return ['script-src'];
    if (equiv.toLowerCase() !== 'content-security-policy') continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!contentMatch) continue;
    const content = String(contentMatch[1] ?? contentMatch[2] ?? contentMatch[3]);
    if (/&(?:#x?[\da-f]+|[a-z][a-z\d]+);/i.test(content)) return ['script-src'];
    policies.push(content);
  }
  return policies;
}

export function permitsInlineBootstrap(policyValues, html = '') {
  const policies = [...(Array.isArray(policyValues) ? policyValues : policyValues ? [policyValues] : []), ...metaCspPolicies(html)];
  return policies.every((value) => String(value).split(/,\s*(?=[a-z-]+\s)/i).every((policy) => {
    const directives = policy.split(';').map((part) => part.trim());
    const scriptDirective = directives.find((part) => /^script-src-elem(?:\s|$)/i.test(part))
      || directives.find((part) => /^script-src(?:\s|$)/i.test(part))
      || directives.find((part) => /^default-src(?:\s|$)/i.test(part));
    if (!scriptDirective) return true;
    const sources = scriptDirective.replace(/^[^\s]+/, '').trim().split(/\s+/);
    const hasNonceOrHash = sources.some((source) => /^'(?:nonce-|sha(?:256|384|512)-)/i.test(source));
    return sources.some((source) => source.toLowerCase() === "'unsafe-inline'") && !hasNonceOrHash;
  }));
}

function parentOriginFor(req) {
  const host = String(req.headers.host || '').trim();
  if (!host || /[\s@?#]/.test(host) || host.includes('/') || host.includes('\\')) return '';
  const protocol = req.socket?.encrypted ? 'https:' : 'http:';
  let origin;
  try { origin = new URL(`${protocol}//${host}`); } catch { return ''; }
  try {
    const referer = new URL(req.headers.referer || '');
    if (referer.host.toLowerCase() === origin.host.toLowerCase()) return referer.origin;
  } catch {}
  return origin.origin;
}

async function safeUpstreamRequest(url, accept, range = '', method = 'GET', userAgent = BROWSER_USER_AGENT) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 15_000);
  let completed = false;
  try {
    let current = validatePublicUrl(url.href);

    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const addresses = await validateResolvedHost(current, controller.signal);
      const response = await requestPinned(current, addresses, accept, range, method, controller.signal, userAgent);
      const status = response.statusCode || 502;
      if (![301, 302, 303, 307, 308].includes(status)) {
        completed = true;
        response.once('close', () => clearTimeout(deadline));
        return { response, url: current };
      }
      const location = response.headers.location;
      response.destroy();
      if (!location || redirects === 5) throw new Error('The website redirected too many times or returned an invalid redirect.');
      current = validatePublicUrl(new URL(location, current).href);
    }
    throw new Error('The website redirected too many times.');
  } finally {
    if (!completed) clearTimeout(deadline);
  }
}

async function handleEmbedCheck(req, res, requestUrl) {
  let target;
  try {
    target = validatePublicUrl(requestUrl.searchParams.get('url') || '');
    if (target.protocol !== 'https:') throw new Error('Embedded providers must use HTTPS.');
  } catch (error) {
    json(res, /private|local network|cannot be reached/i.test(error.message) ? 403 : 400, { embeddable: false, error: error.message });
    return;
  }
  let current = target;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 10_000);
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const addresses = await validateResolvedHost(current, controller.signal);
      let response = await requestPinned(current, addresses, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', '', 'HEAD', controller.signal);
      // Some hosts answer HEAD with an error (403 for raw.githack.com, 405 elsewhere) while a GET works,
      // so retry with a one-byte ranged GET whenever HEAD did not produce a usable status.
      if (![200, 204, 301, 302, 303, 307, 308].includes(response.statusCode || 502)) {
        response.destroy();
        response = await requestPinned(current, addresses, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'bytes=0-0', 'GET', controller.signal);
      }
      const status = response.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.destroy();
        if (!location || redirects === 5) throw new Error('The provider redirected too many times or returned an invalid redirect.');
        current = validatePublicUrl(new URL(location, current).href);
        if (current.protocol !== 'https:') throw new Error('Embedded providers must remain on HTTPS.');
        continue;
      }
      const headers = response.headers;
      response.destroy();
      if (status < 200 || status >= 300) throw new Error(`The provider refused the permission check (HTTP ${status}).`);
      const contentType = String(headers['content-type'] || '').split(';')[0].toLowerCase();
      if (contentType && !['text/html', 'application/xhtml+xml'].includes(contentType)) throw new Error('This URL does not appear to be an embeddable page. Configure the provider’s official embed URL.');
      const policyError = framePolicyError(headers, parentOriginFor(req), current);
      if (policyError) { json(res, 200, { embeddable: false, url: current.href, error: policyError }); return; }
      json(res, 200, { embeddable: true, url: current.href });
      return;
    }
  } catch (error) {
    const status = error.name === 'AbortError' ? 504 : /private|local network|cannot be reached/i.test(error.message) ? 403 : 502;
    json(res, status, { embeddable: false, error: error.name === 'AbortError' ? 'The provider permission check timed out.' : error.message || 'The provider could not be reached safely.' });
  } finally { clearTimeout(deadline); }
}

// Some sites bounce a click through a tiny JavaScript stub such as
// `window.parent.location.replace('https://target')`. A sandboxed frame is not allowed to navigate its
// ancestors, so the stub would leave the frame blank (and running it un-sandboxed would navigate
// GoonCore itself away). The relay recognises a pure redirect stub and forwards it as a real hop
// instead, so the destination loads through the normal rewriting path.
const CLIENT_REDIRECT_STUB_LIMIT = 4096;
const CLIENT_REDIRECT_PATTERNS = [
  /(?:window\s*\.\s*)?(?:top|parent|self)?\s*\.?\s*location\s*\.\s*(?:replace|assign)\s*\(\s*["']([^"']+)["']/gi,
  /(?:window\s*\.\s*)?(?:top|parent|self)?\s*\.?\s*location\s*\.\s*href\s*=\s*["']([^"']+)["']/gi,
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*["']?([^"';>]+)/gi,
];

export function clientRedirectTarget(html, base) {
  const source = String(html);
  if (!source || source.length > CLIENT_REDIRECT_STUB_LIMIT) return null;
  // Only a document with nothing else to show counts as a stub.
  if (/<a\b[^>]*\bhref|<img\b|<iframe\b|<form\b|<script\b[^>]*\bsrc/i.test(source)) return null;
  const found = new Set();
  for (const pattern of CLIENT_REDIRECT_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.add(match[1].trim());
  }
  if (found.size !== 1) return null;
  try {
    const destination = new URL([...found][0], base);
    return ['http:', 'https:'].includes(destination.protocol) ? validatePublicUrl(destination.href) : null;
  } catch { return null; }
}

function clientRedirectDocument(destination, frameId) {
  const relay = proxyPath(destination, frameId);
  const target = escapeAttribute(relay);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GoonCore · following link</title><style>html,body{min-height:100%;margin:0;background:#08090a;color:#eee;font:13px/1.65 system-ui,sans-serif}body{display:grid;place-items:center;padding:24px;box-sizing:border-box}main{max-width:420px;text-align:center}p{margin:0 0 8px;color:#9a9a9a}a{color:#7ab8ff}</style><main><p>Following this link to ${escapeAttribute(destination.hostname)}…</p><p><a href="${target}">Continue to ${escapeAttribute(destination.hostname)}</a></p></main><script>parent.postMessage({type:'gooncore:proxy-navigate',id:${scriptJson(frameId)},url:${scriptJson(destination.href)}},'*');location.replace(${scriptJson(relay)})</script><noscript><meta http-equiv="refresh" content="0;url=${target}"></noscript></html>`;
}

async function handleProxy(req, res, requestUrl) {
  const frameId = validFrameId(requestUrl.searchParams.get('frame'));
  const isTopLevel = requestUrl.searchParams.get('top') === '1';
  let target;
  try { target = validatePublicUrl(requestUrl.searchParams.get('url') || ''); }
  catch (error) {
    const status = error.message.includes('Private') || error.message.includes('cannot be reached') ? 403 : 400;
    proxyError(res, status, error.message, frameId);
    return;
  }
  let upstream;
  try {
    upstream = await safeUpstreamRequest(target, req.headers.accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', req.headers.range || '', req.method || 'GET', clientUserAgent(req));
  } catch (error) {
    const status = error.name === 'AbortError' || error.message.includes('timed out') ? 504 : error.message.includes('Private') || error.message.includes('local network') || error.message.includes('cannot be reached') ? 403 : error.message.includes('redirected') ? 502 : 502;
    proxyError(res, status, error.name === 'AbortError' ? 'The website took too long to respond (15-second total limit).' : error.message || 'The website could not be reached.', frameId);
    return;
  }
  const response = upstream.response;
  const finalUrl = upstream.url;
  const status = response.statusCode || 502;
  const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
  if (encoding !== 'identity') {
    response.destroy();
    proxyError(res, 415, `For safety, GoonCore does not relay compressed responses (${encoding}).`, frameId);
    return;
  }
  const contentType = String(response.headers['content-type'] || 'application/octet-stream');
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if ([401, 403, 407, 429, 451].includes(status)) {
    response.destroy();
    proxyError(res, status, `The destination refused the request (HTTP ${status}). Sign-in, access controls, and paywalls are not bypassed.`, frameId);
    return;
  }
  const isHtml = mediaType === 'text/html' || mediaType === 'application/xhtml+xml';
  const supportedTypes = new Set([
    'text/html', 'application/xhtml+xml', 'text/css', 'text/plain', 'text/xml', 'application/xml', 'application/json',
    'application/javascript', 'text/javascript', 'application/x-javascript', 'application/wasm', 'application/pdf',
    'font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/font-woff', 'application/woff', 'application/vnd.ms-fontobject',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif', 'image/x-icon', 'image/bmp',
  ]);
  if (!supportedTypes.has(mediaType)) {
    response.destroy();
    proxyError(res, 415, `For safety, GoonCore does not serve ${mediaType || 'this file type'} through the web relay.`, frameId);
    return;
  }
  const declaredSize = Number(response.headers['content-length'] || 0);
  if (declaredSize > BODY_LIMIT) {
    response.destroy();
    proxyError(res, 413, 'This response exceeds the 1 MB proxy limit.', frameId);
    return;
  }
  let body = Buffer.alloc(0);
  if (req.method !== 'HEAD') {
    try { body = await collectLimited(response); }
    catch (error) {
      if (!res.headersSent) proxyError(res, 413, error.message, frameId);
      return;
    }
  } else response.resume();
  const upstreamCsp = response.headers['content-security-policy'];
  if (isHtml && req.method !== 'HEAD') {
    const html = body.toString('utf8');
    const stub = clientRedirectTarget(html, finalUrl);
    if (stub) {
      const document = clientRedirectDocument(stub, frameId);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(document),
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'",
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(document);
      return;
    }
    const cspValues = Array.isArray(upstreamCsp) ? upstreamCsp : upstreamCsp ? [upstreamCsp] : [];
    const permitsInline = permitsInlineBootstrap(cspValues, html);
    body = Buffer.from(rewriteHtml(html, finalUrl, frameId, permitsInline, isTopLevel && target.href !== finalUrl.href));
  } else if (mediaType === 'text/css' && req.method !== 'HEAD') body = Buffer.from(rewriteCss(body.toString('utf8'), finalUrl, frameId));
  if (body.length > BODY_LIMIT) { proxyError(res, 413, 'The rewritten response exceeds the 1 MB proxy limit.', frameId); return; }
  const headers = {
    'Content-Type': contentType,
    'X-Content-Type-Options': response.headers['x-content-type-options'] || 'nosniff',
    'Referrer-Policy': response.headers['referrer-policy'] || 'no-referrer',
    'Cache-Control': 'private, max-age=60',
  };
  headers['Content-Security-Policy'] = relayContentSecurityPolicy(upstreamCsp);
  headers['X-Frame-Options'] = 'SAMEORIGIN';
  if (response.headers['cross-origin-opener-policy']) headers['Cross-Origin-Opener-Policy'] = response.headers['cross-origin-opener-policy'];
  if (response.headers['cross-origin-embedder-policy']) headers['Cross-Origin-Embedder-Policy'] = response.headers['cross-origin-embedder-policy'];
  if (response.headers['cross-origin-resource-policy']) headers['Cross-Origin-Resource-Policy'] = response.headers['cross-origin-resource-policy'];
  if (response.headers['permissions-policy']) headers['Permissions-Policy'] = response.headers['permissions-policy'];
  if (response.headers['content-range']) headers['Content-Range'] = response.headers['content-range'];
  if (response.headers['accept-ranges']) headers['Accept-Ranges'] = response.headers['accept-ranges'];
  if (req.method === 'HEAD') {
    if (declaredSize && !isHtml) headers['Content-Length'] = declaredSize;
  } else headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

function gameCategory(title) {
  const value = String(title || '').toLowerCase();
  if (/\b(race|racing|drift|moto|motor|car|bike|rider|road|rally|kart)\b/.test(value)) return 'Racing';
  if (/\b(basket|football|soccer|golf|pool|bowling|archery|tennis|baseball|sports?|boxing|skate|ski)\b/.test(value)) return 'Sports';
  if (/\b(chess|wordle|word|2048|bloxorz|puzzle|brain|sort|sudoku|crossword|mahjong|memory|tetris)\b/.test(value)) return 'Puzzle';
  if (/\b(shooter|shoot|battle|war|combat|doom|quake|ultrakill|weapon|gun|fnaf|freddy|horror|survival|fight|duel|archer)\b/.test(value)) return 'Action';
  if (/\b(adventure|quest|world|minecraft|story|life|simulator|rpg|platform|explore|run)\b/.test(value)) return 'Adventure';
  return 'Arcade';
}

function trustedCatalogUrl(template, assetType) {
  if (typeof template !== 'string' || template.length > 2048) return '';
  const urlText = template.replaceAll('{COVER_URL}', GAME_COVER_BASE).replaceAll('{HTML_URL}', GAME_HTML_BASE);
  let url;
  try { url = new URL(urlText); } catch { return ''; }
  const cover = assetType === 'cover';
  const host = cover ? 'raw.githubusercontent.com' : 'gn-math.github.io';
  const prefix = cover ? '/gn-math/covers/main/' : '/html/';
  const file = cover ? /^[\w.-]+\.(?:png|jpe?g|webp)$/i : /^[\w.-]+\.html?$/i;
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { return ''; }
  // Only the direct file inside the pinned directory is trusted: no traversal, nested paths or
  // encoded separators survive this allowlist.
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password || url.search || url.hash
      || !decodedPath.startsWith(prefix) || !file.test(decodedPath.slice(prefix.length))) return '';
  return url.href;
}

export function normalizeGameCatalog(manifest) {
  if (!Array.isArray(manifest)) throw new Error('The GN Math game list is not a JSON array.');
  const seen = new Set();
  const games = [];
  for (const entry of manifest) {
    if (!entry || typeof entry !== 'object') continue;
    const numericId = entry.id;
    const title = typeof entry.name === 'string' ? entry.name.trim().slice(0, 140) : '';
    const gameUrl = trustedCatalogUrl(entry.url, 'game');
    const cover = trustedCatalogUrl(entry.cover, 'cover');
    if (typeof numericId !== 'number' || !Number.isSafeInteger(numericId) || numericId < 0 || !title || !gameUrl || !cover || seen.has(numericId)) continue;
    seen.add(numericId);
    games.push({
      id: String(numericId),
      title,
      cover,
      gameUrl,
      category: gameCategory(title),
      source: 'GN Math public catalog',
      featured: entry.featured === true,
    });
    if (games.length >= 2000) break;
  }
  if (!games.length) throw new Error('The GN Math manifest did not contain any supported individual games.');
  return games;
}

async function readLimitedResponse(response, limit) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > limit) throw new Error('The public game manifest exceeds the 2 MB size limit.');
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('The public game manifest exceeds the 2 MB size limit.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

async function fetchGameCatalog() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('The public game manifest timed out.')), GAME_CATALOG_TIMEOUT_MS);
  try {
    const source = validatePublicUrl(GAME_MANIFEST_URL);
    const addresses = await validateResolvedHost(source, controller.signal);
    const response = await requestPinned(source, addresses, 'application/json,text/plain;q=0.8', '', 'GET', controller.signal);
    const status = response.statusCode || 502;
    if (status >= 300 && status < 400) { response.destroy(); throw new Error('The public game manifest redirected unexpectedly.'); }
    if (status < 200 || status >= 300) { response.destroy(); throw new Error(`The public game manifest returned HTTP ${status}.`); }
    const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
    if (encoding !== 'identity') { response.destroy(); throw new Error('The public game manifest returned an unsupported compressed response.'); }
    const mediaType = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
    if (mediaType && !['application/json', 'text/plain'].includes(mediaType)) { response.destroy(); throw new Error('The public game manifest did not return JSON.'); }
    const declaredSize = Number(response.headers['content-length'] || 0);
    if (declaredSize > GAME_CATALOG_MAX_BYTES) { response.destroy(); throw new Error('The public game manifest exceeds the 2 MB size limit.'); }
    const data = JSON.parse((await collectLimited(response, GAME_CATALOG_MAX_BYTES)).toString('utf8'));
    const games = normalizeGameCatalog(data);
    gameCatalogCache = { games, fetchedAt: Date.now(), expiresAt: Date.now() + GAME_CATALOG_MAX_AGE };
    return { games, stale: false, cachedAt: new Date(gameCatalogCache.fetchedAt).toISOString() };
  } finally { clearTimeout(timeout); }
}

async function handleGames(res) {
  if (gameCatalogCache && gameCatalogCache.expiresAt > Date.now()) {
    json(res, 200, { games: gameCatalogCache.games, stale: false, cachedAt: new Date(gameCatalogCache.fetchedAt).toISOString() }, { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
    return;
  }
  try {
    if (!gameCatalogPending) {
      gameCatalogPending = fetchGameCatalog().finally(() => { gameCatalogPending = null; });
    }
    const catalog = await gameCatalogPending;
    json(res, 200, catalog, { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
  } catch (error) {
    if (gameCatalogCache) {
      json(res, 200, { games: gameCatalogCache.games, stale: true, cachedAt: new Date(gameCatalogCache.fetchedAt).toISOString(), warning: 'The live game catalog could not be refreshed; showing the last cached list.' }, { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' });
      return;
    }
    json(res, error.name === 'AbortError' ? 504 : 502, { error: error.name === 'AbortError' ? 'The GN Math catalog timed out. Try again shortly.' : error.message || 'The GN Math catalog is temporarily unavailable.' });
  }
}

async function serveStatic(pathname, res, method = 'GET') {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { json(res, 400, { error: 'Invalid address.' }); return; }
  const relative = normalize(decoded.replace(/^\/+/, ''));
  if (relative.startsWith('..') || relative.includes(`..${sep}`)) { json(res, 403, { error: 'Forbidden.' }); return; }
  let path = join(WEBROOT, relative || 'index.html');
  try {
    path = await realpath(path);
    const root = await realpath(WEBROOT);
    if (path !== root && !path.startsWith(`${root}${sep}`)) { json(res, 403, { error: 'Forbidden.' }); return; }
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file.');
    const isHtml = extname(path) === '.html';
    const contentType = MIME[extname(path)] || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', isHtml ? 'no-cache' : 'public, max-age=300, stale-while-revalidate=86400');
    if (isHtml) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://raw.githubusercontent.com https://gn-math.github.io; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'self' https:; form-action 'self' https:; frame-ancestors 'self'");
    res.setHeader('Content-Length', String(info.size));
    if (method === 'HEAD') { res.end(); return; }
    if (info.size > 256_000) {
      await new Promise((resolveStream, rejectStream) => { const stream = createReadStream(path); stream.once('error', rejectStream); res.once('finish', resolveStream); stream.pipe(res); });
    } else res.end(await readFile(path));
  } catch {
    if (res.headersSent) { res.destroy(); return; }
    if (extname(decoded)) { json(res, 404, { error: 'Not found.' }); return; }
    await serveStatic('/index.html', res, method);
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  let url;
  try { url = new URL(req.url || '/', `http://${HOST}:${PORT}`); }
  catch { json(res, 400, { error: 'Invalid request.' }); return; }
  if (!['GET', 'HEAD'].includes(req.method || 'GET')) { res.setHeader('Allow', 'GET, HEAD'); json(res, 405, { error: 'Method not allowed.' }); return; }
  if (url.pathname.startsWith('/api/') && !rateLimit(req, res, url.pathname === '/api/proxy' ? PROXY_LIMIT : API_LIMIT)) return;
  if (url.pathname === '/api/health') { json(res, 200, { ok: true, proxy: true }); return; }
  if (url.pathname === '/api/proxy') { await handleProxy(req, res, url); return; }
  if (url.pathname === '/api/embed-check') { await handleEmbedCheck(req, res, url); return; }
  if (url.pathname === '/api/search') { handleSearch(res, url); return; }
  if (url.pathname === '/api/games') { await handleGames(res); return; }
  if (url.pathname.startsWith('/api/')) { json(res, 404, { error: 'API route not found.' }); return; }
  await serveStatic(url.pathname, res, req.method);
});

server.requestTimeout = 12_000;
server.headersTimeout = 13_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  server.listen(PORT, HOST, () => console.log(`GoonCore running at http://${HOST}:${PORT} · proxy ready · Ctrl+C to stop`));
}

export { server, clientAddress };
