function makeProxyUrl(url, frameId) {
  const params = new URLSearchParams({ url, top: '1' });
  if (frameId) params.set('frame', frameId);
  return `/api/proxy?${params}`;
}

function looksLikeWebAddress(value) {
  const query = String(value || '').trim();
  return /^(?:https?:\/\/|www\.)/i.test(query)
    || /^[a-z][a-z\d+.-]*:\/\//i.test(query)
    || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(query)
    || /^(?:[^\s.]+\.)+[a-z\u0080-\uFFFF]{2,}(?::\d+)?(?:[/?#]|$)/i.test(query);
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) throw new Error('Enter a public web address or a search query.');
  if (!looksLikeWebAddress(raw)) return { query: raw };
  const candidate = /^(?:https?:\/\/)/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(candidate); } catch { throw new Error('Enter a valid public HTTP or HTTPS address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Only public HTTP and HTTPS addresses are supported.');
  if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) throw new Error('For safety, only standard public HTTP and HTTPS ports are available.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || ['.localhost', '.local', '.internal', '.test', '.invalid', '.example'].some((suffix) => host === suffix.slice(1) || host.endsWith(suffix)) || host === 'metadata.google.internal') throw new Error('Private and internal addresses cannot be opened.');
  if (/^(?:0|10|127|169\.254|172\.(?:1[6-9]|2\d|3[01])|192\.168|22[4-9]|23\d|24\d|25[0-5])\./.test(host) || host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host) || host.startsWith('ff')) throw new Error('Private and internal addresses cannot be opened.');
  return { url: url.href };
}

function hostFor(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

async function resolveSearch(ctx, query, signal) {
  const response = await fetch(ctx.searchUrl(query), { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok || typeof data.url !== 'string') throw new Error(data.error || 'Search is unavailable. Please try again.');
  const result = new URL(data.url);
  if (!['http:', 'https:'].includes(result.protocol) || result.username || result.password) throw new Error('Search returned an unsupported web address.');
  return result.href;
}

function historyMarkup(ctx) {
  const items = (ctx.data.recent || []).slice(0, 6);
  return items.length ? `<div class="proxy-history" aria-label="Recent pages">${items.map((item) => `<button type="button" class="proxy-history-item" data-history-url="${ctx.esc(item.url)}" title="${ctx.esc(item.url)}">${ctx.esc(item.title || item.host || item.url)}</button>`).join('')}</div>` : '';
}

function makeFrameId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replaceAll('-', '');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function mount(ctx, { url = '', query = '', history = [], historyIndex } = {}) {
  const safeUrl = typeof url === 'string' && url.length < 2048 ? url : '';
  const safeQuery = typeof query === 'string' ? query.slice(0, 512) : '';
  const entries = Array.isArray(history) ? history.filter((entry) => typeof entry === 'string' && entry.length < 2048).slice(-40) : [];
  if (safeUrl && entries.at(-1) !== safeUrl && !entries.includes(safeUrl)) entries.push(safeUrl);
  const index = safeUrl ? (Number.isInteger(historyIndex) && historyIndex >= 0 && historyIndex < entries.length ? historyIndex : entries.lastIndexOf(safeUrl)) : -1;
  const host = hostFor(safeUrl);
  const hasTarget = Boolean(safeUrl || safeQuery);
  // The loading, error and frame nodes must always exist: a search typed into an otherwise empty
  // Web page still has to be able to show progress, results and errors.
  const content = `<div class="proxy-browser-content${hasTarget ? '' : ' proxy-browser-empty'}">${hasTarget ? '' : `<div class="proxy-empty" data-proxy-empty><span class="proxy-empty-icon" aria-hidden="true">${ctx.icon('web')}</span><strong>Your private browser</strong><span>Search a phrase or enter a public HTTP(S) address above to open it here.</span></div>`}<div class="proxy-loading" data-proxy-loading role="status"${hasTarget ? '' : ' hidden'}><span class="spinner" aria-hidden="true"></span><span>Connecting securely…</span></div><div class="proxy-error" data-proxy-error role="alert" hidden><span class="proxy-empty-icon" aria-hidden="true">${ctx.icon('shield')}</span><strong data-proxy-error-title>Couldn’t open this page</strong><p data-proxy-error-message>The site may be offline, refuse relays, or require an unsupported browser feature.</p><button type="button" class="secondary-button" data-proxy-retry>Try again</button></div><iframe class="proxy-iframe" data-proxy-frame title="Proxied page: ${ctx.esc(host)}" sandbox="allow-scripts allow-forms" referrerpolicy="no-referrer" loading="eager" allow="fullscreen" hidden></iframe></div>`;
  return `<header class="page-intro"><div><p class="eyebrow"><span class="privacy-indicator"></span>THE OPEN WEB, THROUGH YOU</p><h1>Web</h1><p>Browse public sites in an isolated window. Pages are relayed from this machine and rendered inside a sandbox, so they open here instead of a new tab.</p></div></header>
    <section class="proxy-browser" aria-label="GoonCore browser">
      <form class="proxy-browser-toolbar" data-web-form>
        <div class="proxy-browser-actions">
          <button type="button" class="icon-button" data-history-back aria-label="Go back" title="Back"${index <= 0 ? ' disabled' : ''}>←</button>
          <button type="button" class="icon-button" data-history-forward aria-label="Go forward" title="Forward"${index < 0 || index >= entries.length - 1 ? ' disabled' : ''}>→</button>
          <button type="button" class="icon-button" data-proxy-reload aria-label="Reload page" title="Reload"${!safeUrl ? ' disabled' : ''}>↻</button>
          <button type="button" class="icon-button" data-proxy-home aria-label="Browser home" title="Home">⌂</button>
          <button type="button" class="icon-button" data-proxy-fullscreen aria-label="Full screen browser" title="Full screen" aria-pressed="false"${hasTarget ? '' : ' disabled'}>⛶</button>
        </div>
        <label class="search-box proxy-address-box"><span class="search-mark">${ctx.icon('globe')}</span><input id="proxy-address" name="address" class="search-input" type="text" inputmode="url" autocomplete="url" maxlength="2048" spellcheck="false" placeholder="Search or enter a public URL" aria-label="Search or enter a public URL" value="${ctx.esc(safeUrl || safeQuery)}"><button type="button" class="icon-button proxy-clear" data-web-clear aria-label="Clear address">×</button></label>
        <button class="primary-button proxy-go" type="submit">Go</button>
      </form>
      <div class="proxy-browser-meta"><span class="proxy-frame-url" data-proxy-current title="${ctx.esc(safeUrl)}">${ctx.esc(safeUrl || 'Ready for a public website')}</span><span class="proxy-frame-status" data-proxy-status>${safeUrl ? 'Connecting' : 'Private · local relay'}</span></div>
      ${content}
    </section>
    ${historyMarkup(ctx)}
    <div class="proxy-note"><span class="proxy-note-icon" aria-hidden="true">ⓘ</span><span><strong>Private by design, with real limits.</strong> The local backend validates destinations and DNS, blocks private networks, follows public redirects, applies timeouts and response caps, and serves supported resources. Pages are re-served by this relay and stay sandboxed, so only GoonCore can frame them; DRM, sign-in, and paywalls are still never bypassed.</span></div>`;
}

export function activate(ctx, main, { url = '', query = '', history = [], historyIndex } = {}) {
  const form = main.querySelector('[data-web-form]');
  const field = form?.elements.address;
  const frame = main.querySelector('[data-proxy-frame]');
  const loading = main.querySelector('[data-proxy-loading]');
  const errorPanel = main.querySelector('[data-proxy-error]');
  const status = main.querySelector('[data-proxy-status]');
  const currentLabel = main.querySelector('[data-proxy-current]');
  const empty = main.querySelector('[data-proxy-empty]');
  const browser = main.querySelector('.proxy-browser');
  const fullscreenButton = main.querySelector('[data-proxy-fullscreen]');
  const frameId = makeFrameId();
  let entries = Array.isArray(history) ? history.filter((entry) => typeof entry === 'string').slice(-40) : [];
  let index = -1;
  if (url) {
    if (!entries.includes(url)) entries.push(url);
    index = Number.isInteger(historyIndex) && historyIndex >= 0 && historyIndex < entries.length ? historyIndex : entries.lastIndexOf(url);
  }
  let loadTimer;
  let searchController;
  let active = true;

  const syncControls = () => {
    main.querySelector('[data-history-back]').disabled = index <= 0;
    main.querySelector('[data-history-forward]').disabled = index < 0 || index >= entries.length - 1;
    main.querySelector('[data-proxy-reload]').disabled = index < 0;
  };
  const showLoading = () => {
    if (empty) empty.hidden = true;
    loading.hidden = false;
    errorPanel.hidden = true;
    frame.hidden = true;
  };
  const resetFrame = (target) => {
    clearTimeout(loadTimer);
    if (fullscreenButton) fullscreenButton.disabled = !target;
    if (!target) {
      frame?.removeAttribute('src');
      frame.hidden = true;
      loading.hidden = true;
      errorPanel.hidden = true;
      if (empty) empty.hidden = false;
      currentLabel.textContent = 'Ready for a public website';
      currentLabel.title = '';
      status.textContent = 'Private · local relay';
      field.value = '';
      syncControls();
      return;
    }
    field.value = target;
    currentLabel.textContent = target;
    currentLabel.title = target;
    status.textContent = 'Connecting';
    errorPanel.hidden = true;
    loading.hidden = false;
    if (empty) empty.hidden = true;
    frame.hidden = false;
    frame.src = makeProxyUrl(target, frameId);
    loadTimer = setTimeout(() => {
      if (!active || !frame.isConnected) return;
      loading.hidden = true;
      errorPanel.hidden = false;
      main.querySelector('[data-proxy-error-title]').textContent = 'This site did not respond in time';
      main.querySelector('[data-proxy-error-message]').textContent = 'It may be offline, block relays, or require an unsupported browser feature. Try another public page.';
      status.textContent = 'Timed out';
    }, 12_000);
    syncControls();
  };
  const goTo = (target, replace = false) => {
    entries = entries.slice(0, index + 1);
    if (replace && index >= 0) entries[index] = target;
    else { entries.push(target); index = entries.length - 1; }
    if (entries.length > 40) { entries.shift(); index = Math.max(0, index - 1); }
    if (index < 0) index = entries.length - 1;
    ctx.saveVisit(target);
    ctx.navigate('web', { url: target, history: entries, historyIndex: index }, { focus: false });
  };
  const showError = (title, message) => {
    clearTimeout(loadTimer);
    if (empty) empty.hidden = true;
    loading.hidden = true;
    errorPanel.hidden = false;
    main.querySelector('[data-proxy-error-title]').textContent = String(title).slice(0, 180);
    main.querySelector('[data-proxy-error-message]').textContent = String(message).slice(0, 900);
    status.textContent = 'Unavailable';
  };
  const onFrameMessage = (event) => {
    if (!active || !frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
    const data = event.data;
    if (!data || data.id !== frameId || typeof data.type !== 'string') return;
    if (data.type === 'gooncore:proxy-error') {
      showError(data.title || 'This page could not be opened', data.message || 'The destination is unavailable.');
      return;
    }
    if (data.type === 'gooncore:proxy-redirect') {
      let redirect;
      try {
        redirect = new URL(data.url);
        if (!['http:', 'https:'].includes(redirect.protocol) || redirect.username || redirect.password || !redirect.hostname) return;
      } catch { return; }
      goTo(redirect.href, true);
      return;
    }
    if (data.type !== 'gooncore:proxy-navigate' || typeof data.url !== 'string' || data.url.length > 2048) return;
    let destination;
    try {
      destination = new URL(data.url);
      if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) return;
    } catch { return; }
    const href = destination.href;
    if (entries[index] === href) return;
    entries = entries.slice(0, index + 1);
    entries.push(href);
    if (entries.length > 40) entries.shift();
    index = entries.length - 1;
    ctx.saveVisit(href);
    ctx.navigate('web', { url: href, history: entries, historyIndex: index }, { focus: false });
  };
  const onFrameLoad = () => {
    if (!active) return;
    clearTimeout(loadTimer);
    loading.hidden = true;
    status.textContent = 'Loaded · sandboxed';
  };
  const onAddressInput = () => {
    searchController?.abort();
    if (field.value.length > 2048) field.value = field.value.slice(0, 2048);
  };
  const onFrameError = () => showError('This page could not be loaded', 'The local relay rejected this response or the browser blocked its document. GoonCore will not bypass site security.');
  frame?.addEventListener('load', onFrameLoad);
  frame?.addEventListener('error', onFrameError);
  window.addEventListener('message', onFrameMessage);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    searchController?.abort();
    searchController = new AbortController();
    const parsed = (() => { try { return normalizeAddress(field.value); } catch (error) { ctx.toast(error.message, 'error'); return null; } })();
    if (!parsed) return;
    if (parsed.query) {
      showLoading();
      status.textContent = 'Searching privately…';
      try { goTo(await resolveSearch(ctx, parsed.query, searchController.signal)); }
      catch (error) { if (error.name !== 'AbortError' && active) showError('Search could not be opened', error.message || 'Try again.'); }
      return;
    }
    goTo(parsed.url);
  });
  main.querySelector('[data-history-back]')?.addEventListener('click', () => {
    if (index <= 0) return;
    index -= 1;
    ctx.navigate('web', { url: entries[index], history: entries, historyIndex: index });
  });
  main.querySelector('[data-history-forward]')?.addEventListener('click', () => {
    if (index >= entries.length - 1) return;
    index += 1;
    ctx.navigate('web', { url: entries[index], history: entries, historyIndex: index });
  });
  main.querySelector('[data-proxy-reload]')?.addEventListener('click', () => { if (index >= 0) resetFrame(entries[index]); });
  main.querySelector('[data-proxy-home]')?.addEventListener('click', () => ctx.navigate('home'));
  // Full screen is an in-app overlay rather than the HTML Fullscreen API: the request depends on the
  // host (embedded hosts can deny it, or leave the promise pending forever), while the overlay always
  // works the same way and is dismissed with Escape.
  const isFullscreen = () => document.documentElement.classList.contains('web-fullscreen');
  const syncFullscreen = () => {
    if (!fullscreenButton) return;
    const active = isFullscreen();
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.setAttribute('aria-label', active ? 'Exit full screen' : 'Full screen browser');
    fullscreenButton.setAttribute('title', active ? 'Exit full screen' : 'Full screen');
  };
  const leaveFullscreen = () => {
    document.documentElement.classList.remove('web-fullscreen');
    syncFullscreen();
  };
  const onFullscreenToggle = () => {
    if (!browser) return;
    if (isFullscreen()) leaveFullscreen();
    else { document.documentElement.classList.add('web-fullscreen'); syncFullscreen(); }
  };
  const onFullscreenKey = (event) => { if (event.key === 'Escape' && isFullscreen()) leaveFullscreen(); };
  fullscreenButton?.addEventListener('click', onFullscreenToggle);
  document.addEventListener('keydown', onFullscreenKey);
  main.querySelector('[data-web-clear]')?.addEventListener('click', () => { field.value = ''; field.focus(); });
  field?.addEventListener('input', onAddressInput, { passive: true });
  main.querySelector('[data-proxy-retry]')?.addEventListener('click', () => { if (index >= 0) resetFrame(entries[index]); });
  main.querySelectorAll('[data-history-url]').forEach((button) => button.addEventListener('click', () => goTo(button.dataset.historyUrl)));
  main.__cleanup = () => { active = false; searchController?.abort(); clearTimeout(loadTimer); field?.removeEventListener('input', onAddressInput); window.removeEventListener('message', onFrameMessage); frame?.removeEventListener('load', onFrameLoad); frame?.removeEventListener('error', onFrameError); fullscreenButton?.removeEventListener('click', onFullscreenToggle); document.removeEventListener('keydown', onFullscreenKey); document.documentElement.classList.remove('web-fullscreen'); if (frame) frame.src = 'about:blank'; };
  syncControls();
  if (url) resetFrame(url);
  else if (query) {
    showLoading();
    status.textContent = 'Searching privately…';
    searchController = new AbortController();
    resolveSearch(ctx, String(query).slice(0, 512), searchController.signal).then((target) => { if (active) goTo(target); }).catch((error) => { if (error.name !== 'AbortError' && active) showError('Search could not be opened', error.message || 'Try again.'); });
  }
}
