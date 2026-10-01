const THEMES = [
  { id: 'midnight', label: 'Midnight', surface: '#0c0d0f', accent: '#c3a783' },
  { id: 'amoled', label: 'AMOLED', surface: '#000000', accent: '#dedede' },
  { id: 'cyber', label: 'Cyber', surface: '#090d13', accent: '#54e5cc' },
  { id: 'purple', label: 'Purple', surface: '#100d15', accent: '#b49af6' },
  { id: 'ocean', label: 'Ocean', surface: '#091014', accent: '#84bfe6' },
  { id: 'forest', label: 'Forest', surface: '#0b100c', accent: '#95c49a' },
  { id: 'crimson', label: 'Crimson', surface: '#110c0d', accent: '#ec8786' },
  { id: 'sunset', label: 'Sunset', surface: '#120e0b', accent: '#efae76' },
  { id: 'monochrome', label: 'Monochrome', surface: '#101010', accent: '#c3c3c3' },
];
const BACKGROUNDS = [['stars', 'Stars'], ['snow', 'Snow'], ['rain', 'Rain'], ['particles', 'Particles'], ['aurora', 'Aurora'], ['grid', 'Grid'], ['blobs', 'Floating blobs'], ['none', 'None']];
const REGIONS = [
  ['', 'Automatic · worldwide'], ['us-en', 'United States · English'], ['uk-en', 'United Kingdom · English'], ['ca-en', 'Canada · English'], ['au-en', 'Australia · English'], ['nz-en', 'New Zealand · English'], ['ie-en', 'Ireland · English'], ['de-de', 'Germany · Deutsch'], ['fr-fr', 'France · Français'], ['es-es', 'Spain · Español'], ['mx-es', 'Mexico · Español'], ['nl-nl', 'Netherlands · Nederlands'], ['br-pt', 'Brazil · Português'], ['jp-jp', 'Japan · 日本語'], ['kr-kr', 'South Korea · 한국어'], ['in-en', 'India · English'],
];
// Search engines are offered as a dropdown: the list is long enough that chips would wrap, and each
// engine carries a note about how well it survives the local relay. DuckDuckGo stays the default.
const ENGINES = [
  ['duckduckgo', 'DuckDuckGo · default'],
  ['google', 'Google'],
  ['bing', 'Bing'],
  ['brave', 'Brave'],
];
const SEGMENTS = (items, setting, value) => `<div class="segmented" role="group" aria-label="${setting}">${items.map(([id, name]) => `<button type="button" class="segment" data-setting="${setting}" data-value="${id}" aria-pressed="${String(value === id)}">${name}</button>`).join('')}</div>`;

function settingRow(title, description, control) {
  return `<div class="settings-card"><div class="setting-copy"><strong>${title}</strong><p>${description}</p></div><div class="setting-control">${control}</div></div>`;
}
function range(title, description, key, value, min = 0, max = 100, suffix = '%') {
  return settingRow(title, description, `<label class="range-control" aria-label="${title}"><input type="range" min="${min}" max="${max}" value="${value}" data-range="${key}" aria-label="${title}"><span class="range-value" data-range-value="${key}">${value}${suffix}</span></label>`);
}

export function mount(ctx) {
  const settings = ctx.settings;
  const themes = THEMES.map((theme) => `<button type="button" class="theme-option${settings.theme === theme.id ? ' is-selected' : ''}" data-theme-pick="${theme.id}" aria-pressed="${settings.theme === theme.id}" aria-label="${theme.label} theme"><span class="theme-swatch" style="--swatch:${theme.surface};--swatch-accent:${theme.accent}"></span><span class="theme-option-label">${theme.label}</span></button>`).join('');
  const movieEmbedUrl = ctx.esc(settings.movieEmbedUrl || '');
  const engine = ['duckduckgo', 'google', 'bing', 'brave'].includes(settings.searchEngine) ? settings.searchEngine : 'duckduckgo';
  return `<header class="page-intro"><div><p class="eyebrow">YOUR SPACE, YOUR RULES</p><h1>Settings</h1><p>A little personal touch. Every choice stays right here on your device.</p></div></header>
  <div class="settings-list"><section class="section" aria-labelledby="appearance-heading"><div class="section-heading"><h2 id="appearance-heading">Look &amp; feel</h2></div>${settingRow('Color theme','Nine carefully tuned palettes, each with its own accent color.',`<div class="theme-swatches">${themes}</div>`)}${settingRow('Animated background', 'Subtle canvas animations, tuned for smoothness rather than spectacle.', SEGMENTS(BACKGROUNDS, 'background', settings.background))}${range('Background opacity','Keep the background gentle, or turn it all the way up.','backgroundOpacity',Number(settings.backgroundOpacity),0,100)}${range('Animation speed','Slow, quiet drifting—or a little faster.','animationSpeed',Number(settings.animationSpeed),10,100)}${range('Particle intensity','Tune background density to suit your screen.','intensity',Number(settings.intensity),0,100)}${settingRow('Pause in background','Stop the animation automatically while the tab is hidden.','<label class="toggle"><span class="toggle-copy">Save power when you’re away</span><input type="checkbox" data-toggle="pauseInactive" aria-label="Pause animations when this tab is hidden"'+(settings.pauseInactive ? ' checked' : '')+'><span class="toggle-track" aria-hidden="true"></span></label>')}${settingRow('Reduced-effects mode','Disable animation and limit visual work—useful on older laptops, battery power, or slow connections.','<label class="toggle"><span class="toggle-copy">Use quieter visuals</span><input type="checkbox" data-toggle="lowPerformance" aria-label="Turn on reduced effects performance mode"'+(settings.lowPerformance ? ' checked' : '')+'><span class="toggle-track" aria-hidden="true"></span></label>')}</section>
  <section class="section" aria-labelledby="search-heading"><div class="section-heading"><h2 id="search-heading">Search</h2><span class="section-note">Runs inside GoonCore · no query log</span></div>${settingRow('Search engine','The engine GoonCore searches with. DuckDuckGo is the default and works best through the local relay. DuckDuckGo and Bing return server-rendered results; Google and Brave expect JavaScript and often answer the relay with their own limited or blocked page.', `<select class="setting-select" data-select="searchEngine" aria-label="Search engine">${ENGINES.map(([id, label]) => `<option value="${id}"${engine === id ? ' selected' : ''}>${label}</option>`).join('')}</select>`)}${settingRow('Safe search','Safe-search preference for the selected engine, applied to searches made from this device.', SEGMENTS([['moderate','Moderate'],['strict','Strict'],['off','Off']], 'safeSearch', settings.safeSearch))}${settingRow('Region','Prefer relevant search results for your locale.', `<select class="setting-select" data-select="region" aria-label="Search region">${REGIONS.map(([id, label]) => `<option value="${ctx.esc(id)}"${settings.region === id ? ' selected' : ''}>${label}</option>`).join('')}</select>`)}</section>
  <section class="section" aria-labelledby="proxy-heading"><div class="section-heading"><h2 id="proxy-heading">Proxy</h2><span class="section-note">A local, open-web convenience</span></div><div class="settings-card"><div class="setting-copy"><strong>Proxy engine</strong><p>HTTP(S) relay provided by your local GoonCore server. Does not route all your traffic or hide it from your network.</p></div><div class="setting-control"><span class="server-status" data-server-status><span class="privacy-indicator"></span>Checking local proxy…</span></div></div><div class="settings-card"><div class="setting-copy"><strong>Allowed destinations</strong><p>Public HTTP/HTTPS hosts only. Loopback, private and link-local IPs are blocked. Redirect targets are validated before following.</p></div><div class="setting-control"><span class="setting-select" aria-label="Proxy security">SSRF protection · always on</span></div></div><div class="notice-card"><strong>Good to know:</strong> some websites refuse proxy traffic, block iframe embedding, require sign-in, or depend on external cookies. The proxy will not load site credentials on your behalf. Never use it for banking, sign-in, or other sensitive information.</div></section>
  <section class="section" aria-labelledby="discover-heading"><div class="section-heading"><h2 id="discover-heading">Movies</h2><span class="section-note">Default provider · editable</span></div>${settingRow('Movie provider URL','The player GoonCore loads in Movies. Defaults to zxcstream.icu; paste another public HTTPS embed URL you are authorized to use. X-Frame-Options and Content-Security-Policy are respected, and there is no tab or site fallback.',`<input class="setting-text" type="url" maxlength="2048" autocomplete="url" inputmode="url" placeholder="https://provider.example/embed" aria-label="Authorized movie provider embed URL" data-movie-embed-url value="${movieEmbedUrl}">`)}<div class="notice-card"><strong>Loaded in-app:</strong> GoonCore never hosts, scrapes, proxies, downloads, or redistributes movies. It only loads the provider configured above, respects that provider’s framing, authentication, and playback rules, and shows an in-app error instead of bypassing them.</div></section>
  <section class="section" aria-labelledby="storage-heading"><div class="section-heading"><h2 id="storage-heading">Your data</h2><span class="section-note">Local on this browser</span></div><div class="settings-card"><div class="setting-copy"><strong>Local preferences</strong><p>Appearance, shortcuts, favorites and browsing history are kept in browser storage. They’re not uploaded to a GoonCore account.</p></div><div class="setting-control"><span class="setting-select">This browser only</span></div></div><div class="settings-footer"><span class="section-note">You can clear or reset this browser’s local data at any time.</span><div style="display:flex;gap:7px"><button type="button" class="secondary-button" data-reset="history">Clear browsing history</button><button type="button" class="danger-button" data-reset="all">Reset local data</button></div></div><div class="settings-footer"><span class="section-note" data-storage-count></span><span class="section-note">GoonCore v1.0 · Free &amp; open web</span></div></section>
  <div class="settings-inline-note">No accounts, trackers, analytics or advertising. Movie provider settings, shortcuts, and preferences are stored locally in your browser.</div></div>`;
}

function refreshSelection(main, key, value) {
  for (const button of main.querySelectorAll(`[data-setting="${CSS.escape(key)}"]`)) button.setAttribute('aria-pressed', String(button.dataset.value === value));
  for (const button of main.querySelectorAll('[data-theme-pick]')) {
    button.classList.toggle('is-selected', button.dataset.themePick === value);
    button.setAttribute('aria-pressed', String(button.dataset.themePick === value));
  }
}
function updateCounter(main) {
  try {
    const keys = ['gooncore.preferences.v1', 'gooncore.personal.v1', 'gooncore.best.2048', 'gooncore.best.snake'];
    const used = keys.reduce((sum, key) => sum + new Blob([localStorage.getItem(key) || '']).size, 0);
    const el = main.querySelector('[data-storage-count]');
    if (el) el.textContent = `GoonCore storage: ${(used / 1024).toFixed(1)} KB used.`;
  } catch {}
}
async function checkHealth(main) {
  const status = main.querySelector('[data-server-status]');
  if (!status) return;
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(1800), cache: 'no-store' });
    const result = await response.json();
    if (!status.isConnected) return;
    status.innerHTML = `<span class="privacy-indicator"></span>${result.proxy && result.ok ? 'Running on this device' : 'Local proxy unavailable'}`;
    if (!(result.proxy && result.ok)) status.querySelector('.privacy-indicator').style.background = 'var(--red)';
  } catch {
    if (status.isConnected) status.innerHTML = '<span class="privacy-indicator" style="background:var(--red)"></span>Could not reach the local server';
  }
}

export function activate(ctx, main) {
  updateCounter(main);
  checkHealth(main);
  main.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;      if (target.dataset.themePick) {
      ctx.updateSettings({ theme: target.dataset.themePick });
      refreshSelection(main, 'theme', target.dataset.themePick);
    } else if (target.dataset.setting) {
      ctx.updateSettings({ [target.dataset.setting]: target.dataset.value });
      refreshSelection(main, target.dataset.setting, target.dataset.value);
    } else if (target.dataset.reset === 'history') {
      if (!confirm('Clear the recent websites saved in this browser? Your favorites and theme will stay.')) return;
      ctx.data.recent = [];
      ctx.persistData();
      updateCounter(main);
      ctx.toast('Browsing history cleared.');
    }  else if (target.dataset.reset === 'all') {
      if (!confirm('Reset every saved preference, favorite, shortcut and recent visit on this browser? This cannot be undone.')) return;
      localStorage.removeItem('gooncore.preferences.v1');
      localStorage.removeItem('gooncore.personal.v1');
      localStorage.removeItem('gooncore.best.2048');
      localStorage.removeItem('gooncore.best.snake');
      ctx.data.recent = [];
      ctx.data.favorites = [];
      ctx.data.customLinks = [];
      ctx.data.recentGames = [];
      ctx.data.favoriteGames = [];
      Object.assign(ctx.settings, { theme: 'midnight', background: 'stars', backgroundOpacity: 88, animationSpeed: 48, intensity: 78, pauseInactive: true, lowPerformance: false, safeSearch: 'moderate', region: '', searchEngine: 'duckduckgo', movieEmbedUrl: 'https://zxcstream.icu/' });
      ctx.navigate('home', {}, { updateHash: false });
      ctx.toast('GoonCore is back to its fresh-start settings.');
    }
  });
  main.addEventListener('change', (event) => {
    const input = event.target;
    if (input.matches('[data-toggle]')) {
      const key = input.dataset.toggle;
      ctx.updateSettings({ [key]: input.checked });
      const copy = input.closest('.toggle')?.querySelector('.toggle-copy');
      if (key === 'pauseInactive' && copy) copy.textContent = input.checked ? 'Save power when you’re away' : 'Keep animating in the background';
      if (key === 'lowPerformance' && input.checked) ctx.toast('Reduced-effects mode is on. Animations are paused.');
    } else if (input.matches('[data-select]')) {
      const key = input.dataset.select;
      ctx.updateSettings({ [key]: input.value });
      if (key === 'searchEngine') ctx.toast(`Search engine set to ${(ENGINES.find(([id]) => id === input.value) || [,'DuckDuckGo'])[1].replace(' · default', '')}.`);
    } else if (input.matches('[data-movie-embed-url]')) {
      if (input.value.length > 2048) { ctx.toast('Provider URLs must be 2,048 characters or less.', 'error'); return; }
      ctx.updateSettings({ movieEmbedUrl: input.value.trim() });
      ctx.toast(input.value.trim() ? 'Authorized provider URL saved on this device.' : 'Movie provider URL cleared.');
    }
  });
  main.addEventListener('input', (event) => {
    const input = event.target;
    if (input.matches('[data-movie-embed-url]')) {
      clearTimeout(main.__movieEmbedSaveTimer);
      main.__movieEmbedSaveTimer = setTimeout(() => {
        if (input.value.length > 2048) { ctx.toast('Provider URLs must be 2,048 characters or less.', 'error'); return; }
        ctx.updateSettings({ movieEmbedUrl: input.value.trim() });
      }, 300);
      return;
    }
    if (!input.matches('[data-range]')) return;
    const key = input.dataset.range;
    const value = Number(input.value);
    const output = main.querySelector(`[data-range-value="${CSS.escape(key)}"]`);
    if (output) output.textContent = `${value}%`;
    clearTimeout(main.__rangeSaveTimer);
    main.__rangeSaveTimer = setTimeout(() => ctx.updateSettings({ [key]: value }), 80);
  }, { passive: true });
}
