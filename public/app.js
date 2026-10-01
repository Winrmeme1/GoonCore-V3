const THEMES = ['midnight', 'amoled', 'cyber', 'purple', 'ocean', 'forest', 'crimson', 'sunset', 'monochrome'];
const BACKGROUNDS = ['stars', 'snow', 'rain', 'particles', 'aurora', 'grid', 'blobs', 'none'];
const PAGES = { home: 'Home', web: 'Web', games: 'Games', movies: 'Movies', settings: 'Settings' };
const STORE_KEY = 'gooncore.preferences.v1';
const DATA_KEY = 'gooncore.personal.v1';
const LEGACY_STORAGE_KEYS = [
  ['nightjar.preferences.v1', STORE_KEY],
  ['nightjar.personal.v1', DATA_KEY],
  ['nightjar.best.2048', 'gooncore.best.2048'],
  ['nightjar.best.snake', 'gooncore.best.snake'],
];
function migrateLegacyStorage() {
  try {
    for (const [legacyKey, currentKey] of LEGACY_STORAGE_KEYS) {
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue === null) continue;
      if (localStorage.getItem(currentKey) === null) {
        let value = legacyValue;
        if (legacyKey === 'nightjar.preferences.v1') {
          try {
            const preferences = JSON.parse(legacyValue);
            if (preferences.background === 'stars' && preferences.backgroundOpacity === 38 && preferences.intensity === 40) {
              preferences.backgroundOpacity = 88;
              preferences.intensity = 78;
              value = JSON.stringify(preferences);
            }
          } catch {}
        }
        localStorage.setItem(currentKey, value);
      }
      localStorage.removeItem(legacyKey);
    }
  } catch {}
}
migrateLegacyStorage();

const DEFAULTS = { theme: 'midnight', background: 'stars', backgroundOpacity: 88, animationSpeed: 48, intensity: 78, pauseInactive: true, lowPerformance: false, safeSearch: 'moderate', region: '', searchEngine: 'duckduckgo', movieEmbedUrl: 'https://zxcstream.icu/' };
const DEFAULT_LINKS = [
  { id: 'search', title: 'DuckDuckGo', host: 'duckduckgo.com', url: 'https://duckduckgo.com/', icon: '⌕' },
  { id: 'youtube', title: 'YouTube', host: 'youtube.com', url: 'https://www.youtube.com/', icon: '▶' },
  { id: 'github', title: 'GitHub', host: 'github.com', url: 'https://github.com/', icon: '⌘' },
  { id: 'reddit', title: 'Reddit', host: 'reddit.com', url: 'https://www.reddit.com/', icon: '◌' },
];
const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  games: '<path d="M6.5 7h11a4 4 0 0 1 3.8 5l-1.1 4a2 2 0 0 1-3.2 1l-2.4-2H9.4l-2.4 2a2 2 0 0 1-3.2-1l-1.1-4a4 4 0 0 1 3.8-5Z"/><path d="M8 10v4m-2-2h4m5-1h.01M18 13h.01"/>',
  movies: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18m10-18v18M3 8h4m-4 8h4m10-8h4m-4 8h4M7 12h10"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6-.2.1a8 8 0 0 1-1.6 1l-.2.1-.3 1.8h-2.8l-.3-1.8-.2-.1a8 8 0 0 1-1.6-1l-.2-.1-1.7.6-1.4-2.4 1.4-1.1.1-.2a8 8 0 0 1 0-2.1l-.1-.2-1.4-1.1 1.4-2.4 1.7.6.2-.1a8 8 0 0 1 1.6-1l.2-.1.3-1.8h2.8l.3 1.8.2.1a8 8 0 0 1 1.6 1l.2.1 1.7-.6 1.4 2.4-1.4 1.1-.1.2a8 8 0 0 1 0 2.1Z" transform="translate(-.8 -1.7) scale(.93)"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.7m0 3h.01"/>',
  keyboard: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M10 9h.01M13 9h.01M16 9h.01M7 12h.01M10 12h.01M13 12h.01M16 12h.01M8 15h8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14m-7-7h14"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  star: '<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8L6.8 19l1-5.8-4.3-4.1 5.9-.9Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
  external: '<path d="M13 5h6v6m0-6-9 9"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : structuredClone(fallback);
  } catch { return structuredClone(fallback); }
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function svgIcon(name, className = '') {
  return `<svg aria-hidden="true" viewBox="0 0 24 24"${className ? ` class="${className}"` : ''}>${ICONS[name] || ICONS.globe}</svg>`;
}

const state = {
  settings: { ...DEFAULTS, ...readJson(STORE_KEY, DEFAULTS) },
  data: { recent: [], favorites: [], customLinks: [], recentGames: [], favoriteGames: [], ...(readJson(DATA_KEY, {}) || {}) },
};
state.data.recent = Array.isArray(state.data.recent) ? state.data.recent.slice(0, 10) : [];
state.data.favorites = Array.isArray(state.data.favorites) ? state.data.favorites.slice(0, 60) : [];
state.data.customLinks = Array.isArray(state.data.customLinks) ? state.data.customLinks.slice(0, 12) : [];
state.data.recentGames = Array.isArray(state.data.recentGames) ? state.data.recentGames.slice(0, 6) : [];
state.data.favoriteGames = Array.isArray(state.data.favoriteGames) ? state.data.favoriteGames.slice(0, 40) : [];
let currentPage = 'home';
let renderSequence = 0;
let writeTimer;
let toastTimer;
let animation = { raf: 0, resize: null, particles: [], lastFrame: 0, width: 0, height: 0, dpr: 1, reduced: false, intersection: true, effect: '' };
let immersivePageActive = false;

function persistData() {
  try { localStorage.setItem(DATA_KEY, JSON.stringify(state.data));  } catch { showToast('Browser storage is full. Remove a few saved links to continue.', 'error'); }
}
function updateSettings(values) {
  const allowed = { theme: THEMES, background: BACKGROUNDS, backgroundOpacity: [0, 100], animationSpeed: [10, 100], intensity: [0, 100], pauseInactive: 'boolean', lowPerformance: 'boolean', safeSearch: ['moderate', 'strict', 'off'], region: ['','us-en','uk-en','ca-en','au-en','nz-en','ie-en','de-de','fr-fr','es-es','mx-es','nl-nl','br-pt','jp-jp','kr-kr','in-en'], searchEngine: ['duckduckgo','google','bing','brave'], movieEmbedUrl: 'string' };
  if (Object.hasOwn(values, 'movieEmbedUrl') && (typeof values.movieEmbedUrl !== 'string' || values.movieEmbedUrl.length > 2048)) return;
  for (const [key, value] of Object.entries(values)) {
    const choices = allowed[key];
    if (!choices || typeof choices === 'string' && typeof value !== choices || Array.isArray(choices) && !choices.includes(value) && !(choices.length === 2 && choices.every(Number.isFinite) && Number.isFinite(value) && value >= choices[0] && value <= choices[1])) return;
  }
  Object.assign(state.settings, values);
  try {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => localStorage.setItem(STORE_KEY, JSON.stringify(state.settings)), 120);
  } catch { showToast('Settings could not be saved by this browser.', 'error'); }
  applySettings();
}
function applySettings() {
  document.documentElement.dataset.theme = THEMES.includes(state.settings.theme) ? state.settings.theme : 'midnight';
  document.documentElement.dataset.background = BACKGROUNDS.includes(state.settings.background) ? state.settings.background : 'none';
  const speed = Math.max(10, Math.min(100, Number(state.settings.animationSpeed) || 48));
  document.documentElement.style.setProperty('--canvas-opacity', `${Math.max(0, Math.min(100, Number(state.settings.backgroundOpacity) || 0)) / 100}`);
  document.documentElement.style.setProperty('--canvas-speed', `${speed / 48}`);
  document.documentElement.style.setProperty('--background-intensity', `${Math.max(0, Math.min(100, Number(state.settings.intensity) || 0)) / 100}`);
  const reduced = Boolean(state.settings.lowPerformance || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.documentElement.classList.toggle('reduce-motion', reduced);
  document.documentElement.classList.toggle('reduce-effects', Boolean(state.settings.lowPerformance));
  updateAnimation();
}
function showToast(message, type = 'success') {
  const region = document.getElementById('toast-region');
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' toast--error' : ''}`;
  const indicator = document.createElement('span');
  indicator.className = 'privacy-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(indicator, text);
  region.replaceChildren(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 3200);
}
function updateAnimation() {
  const canvas = document.getElementById('background-canvas');
  if (!canvas) return;
  if (animation.effect !== state.settings.background) {
    animation.effect = state.settings.background;
    animation.width = 0;
    animation.height = 0;
  }
  const reduced = Boolean(state.settings.lowPerformance || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const noMotion = immersivePageActive || state.settings.background === 'none' || reduced || Number(state.settings.backgroundOpacity) === 0 || Number(state.settings.intensity) === 0;
  if (noMotion) {
    cancelAnimationFrame(animation.raf);
    animation.raf = 0;
    animation.particles = [];
    const context = canvas.getContext('2d', { alpha: true });
    if (context) context.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (state.settings.pauseInactive && (document.hidden || !animation.intersection)) {
    cancelAnimationFrame(animation.raf);
    animation.raf = 0;
    return;
  }
  if (!animation.raf) animation.raf = requestAnimationFrame(drawBackground);
}
function random(min, max) { return min + Math.random() * (max - min); }
function resizeBackground() {
  const canvas = document.getElementById('background-canvas');
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, state.settings.lowPerformance ? 1 : 1.5);
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (animation.width === width && animation.height === height && animation.dpr === dpr) return;
  animation.width = width;
  animation.height = height;
  animation.dpr = dpr;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const effect = state.settings.background;
  const density = effect === 'stars' ? 3200 : 16000;
  const limit = effect === 'stars' ? 1000 : 120;
  const count = Math.max(4, Math.min(limit, Math.round((width * height / density) * (Number(state.settings.intensity) / 50))));
  animation.particles = Array.from({ length: count }, () => ({
    x: random(0, width), y: random(0, height), r: random(0.6, effect === 'snow' ? 2.6 : 2.1),
    dx: random(-0.23, 0.23), dy: random(effect === 'rain' ? 5.4 : effect === 'snow' ? 0.22 : 0.05, effect === 'rain' ? 12 : effect === 'snow' ? 1.05 : 0.49),
    alpha: random(0.22, 0.82), phase: random(0, Math.PI * 2), length: random(8, 21), hue: random(200, 276),
  }));
}
function drawBackground(now) {
  animation.raf = 0;
  if (immersivePageActive || document.hidden && state.settings.pauseInactive) return;
  const canvas = document.getElementById('background-canvas');
  const ctx = canvas?.getContext('2d', { alpha: true });
  if (!ctx) return;
  resizeBackground();
  const w = animation.width;
  const h = animation.height;
  const dpr = animation.dpr;
  if (!w || !h) return;
  const elapsed = Math.min(50, now - (animation.lastFrame || now));
  animation.lastFrame = now;
  const dt = elapsed / 16.67;
  const type = state.settings.background;
  const speed = Math.max(0.1, Math.min(2.1, Number(state.settings.animationSpeed) / 48));
  const intensity = Math.max(0.1, Number(state.settings.intensity) / 50);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const points = animation.particles;
  if (type === 'aurora' || type === 'blobs') {
    const time = now * 0.00008 * speed;
    for (let i = 0; i < (type === 'aurora' ? 3 : 4); i += 1) {
      const phase = time + i * 1.62;
      const x = w * (0.18 + i * 0.205) + Math.sin(phase) * w * 0.11;
      const y = h * (type === 'blobs' ? (0.19 + i % 2 * 0.6) : 0.25) + Math.cos(phase * .77) * h * (type === 'blobs' ? .06 : .12);
      const radius = Math.min(w, h) * (type === 'blobs' ? .23 : .39) * intensity;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const hue = type === 'aurora' ? [169, 212, 272][i % 3] : 206 + i * 18;
      const alpha = Math.min(.06, .017 * intensity);
      gradient.addColorStop(0, `hsla(${hue}, 76%, 57%, ${alpha})`);
      gradient.addColorStop(1, `hsla(${hue}, 76%, 57%, 0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(Math.max(0, x - radius), Math.max(0, y - radius), Math.min(w, radius * 2), Math.min(h, radius * 2));
    }
  }
  if (type === 'grid') {
    const step = state.settings.lowPerformance ? 62 : 48;
    ctx.strokeStyle = 'rgba(190,195,225,.036)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    return;
  }
  if (type === 'stars' || type === 'particles' || type === 'snow') {
    ctx.fillStyle = '#dbe6ff';
    for (const p of points) {
      if (type === 'snow') {
        p.y += p.dy * dt * speed;
        p.x += (p.dx + Math.sin(now * .0004 + p.phase) * .25) * dt * speed;
        if (p.y > h + 3) p.y = -3;
      } else if (type === 'particles') {
        p.x += p.dx * dt * speed;
        p.y -= p.dy * .16 * dt * speed;
        if (p.y < -3) p.y = h + 3;
      }
      if (p.x < -4) p.x = w + 3;
      if (p.x > w + 4) p.x = -3;
      const twinkle = type === 'stars' ? .46 + Math.sin(now * .0012 + p.phase) * .26 : 0;
      ctx.globalAlpha = type === 'snow' ? p.alpha * .68 : Math.min(1, p.alpha * (type === 'stars' ? .65 + twinkle : .57));
      ctx.beginPath();
      ctx.arc(p.x, p.y, type === 'snow' ? p.r * .76 : p.r * .57, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (type === 'rain') {
    ctx.strokeStyle = 'rgba(153,178,231,.16)';
    ctx.lineWidth = .8;
    ctx.beginPath();
    for (const p of points) {
      p.y += p.dy * dt * speed;
      if (p.y > h + p.length) { p.y = -p.length; p.x = random(0, w); }
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.length * .16, p.y + p.length);
    }
    ctx.stroke();
  }
  if (type !== 'stars') animation.raf = requestAnimationFrame(drawBackground);
}

const backgroundCanvas = document.getElementById('background-canvas');
if ('ResizeObserver' in window && backgroundCanvas) {
  const observer = new ResizeObserver(() => { animation.width = 0; updateAnimation(); });
  observer.observe(document.documentElement);
} else window.addEventListener('resize', () => { animation.width = 0; updateAnimation(); }, { passive: true });
const mainObserver = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => { animation.intersection = entry.isIntersecting; updateAnimation(); }, { threshold: 0 }) : null;
mainObserver?.observe(document.querySelector('.app-shell'));
document.addEventListener('visibilitychange', updateAnimation, { passive: true });
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applySettings);

const context = {
  get settings() { return state.settings; },
  get data() { return state.data; },
  updateSettings,
  persistData,
  saveVisit,
  toggleFavorite,
  removeFavorite,
  toggleGameFavorite,
  playGame,
  setImmersive,
  navigate,
  toast: showToast,
  esc: escapeHtml,
  icon: svgIcon,
  setTitle,
  searchUrl,
  openDialog,
  closeDialog,
};

function saveVisit(url, title = '') {
  if (!url) return;
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  const item = { url: parsed.href, title: title || parsed.hostname.replace(/^www\./, ''), host: parsed.hostname.replace(/^www\./, ''), at: Date.now() };
  state.data.recent = [item, ...state.data.recent.filter((x) => x.url !== item.url)].slice(0, 10);
  persistData();
}
function toggleFavorite(item) {
  const found = state.data.favorites.some((entry) => entry.url === item.url);
  if (found) state.data.favorites = state.data.favorites.filter((entry) => entry.url !== item.url);
  else state.data.favorites = [{ title: item.title, host: item.host || hostOf(item.url), url: item.url }, ...state.data.favorites].slice(0, 60);
  persistData();
  window.dispatchEvent(new CustomEvent('gooncore:favorites', { detail: { url: item.url, saved: !found } }));
  return !found;
}
function removeFavorite(url) {
  state.data.favorites = state.data.favorites.filter((item) => item.url !== url);
  persistData();
  window.dispatchEvent(new CustomEvent('gooncore:favorites', { detail: { url, saved: false } }));
}
function toggleGameFavorite(id) {
  const found = state.data.favoriteGames.includes(id);
  state.data.favoriteGames = found ? state.data.favoriteGames.filter((gameId) => gameId !== id) : [...state.data.favoriteGames, id].slice(0, 40);
  persistData();
  window.dispatchEvent(new CustomEvent('gooncore:game-favorites', { detail: { id, saved: !found } }));
  return !found;
}
function playGame(id) {
  const recentGames = state.data.recentGames.filter((game) => game.id !== id);
  state.data.recentGames = [{ id, playedAt: Date.now() }, ...recentGames].slice(0, 6);
  persistData();
}
function setImmersive(value) {
  immersivePageActive = Boolean(value);
  updateAnimation();
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
function searchUrl(query) {
  const params = new URLSearchParams({ q: query.trim().slice(0, 512), safeSearch: state.settings.safeSearch, engine: state.settings.searchEngine });
  if (state.settings.region) params.set('region', state.settings.region);
  return `/api/search?${params}`;
}
function openSearch(query) {
  const safe = query.trim().slice(0, 512);
  if (!safe) { showToast('Enter a search first.'); return; }
  navigate('web', { query: safe });
}
function looksLikeWebsite(value) {
  const query = String(value || '').trim();
  return /^(?:https?:\/\/|www\.)/i.test(query) || /^[a-z][a-z\d+.-]*:/i.test(query) || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/.test(query) || /^(?:[^\s.]+\.)+[a-z\u0080-\uFFFF]{2,}(?::\d+)?(?:[/?#]|$)/i.test(query);
}
function canonicalUrl(value) {
  let input = String(value || '').trim();
  if (!input || input.length > 2048) return null;
  if (/\s/.test(input)) return null;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) input = `https://${input}`;
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    if (url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443'))) return null;
    return url.href;
  } catch { return null; }
}
function goToWeb(input) {
  const raw = input.trim();
  if (!raw) { showToast('Enter a website address to browse.', 'error'); return; }
  if (!looksLikeWebsite(raw)) { openSearch(raw); return; }
  const url = canonicalUrl(raw);
  if (!url) { showToast('Enter a complete HTTP or HTTPS web address.', 'error'); return; }
  saveVisit(url);
  navigate('web', { url });
}
function setTitle(title) { document.title = title === 'Home' ? 'GoonCore' : `${title} — GoonCore`; }
function openDialog(title, bodyMarkup) {
  const dialog = document.getElementById('dialog');
  document.getElementById('dialog-content').innerHTML = `<h2 id="dialog-title">${escapeHtml(title)}</h2>${bodyMarkup}`;
  if (!dialog.open) dialog.showModal();
  document.body.classList.add('scroll-lock');
  const autofocus = dialog.querySelector('[autofocus],input,button');
  requestAnimationFrame(() => autofocus?.focus());
}
function closeDialog() {
  const dialog = document.getElementById('dialog');
  if (dialog.open) dialog.close();
  document.body.classList.remove('scroll-lock');
}
document.getElementById('dialog').addEventListener('close', () => document.body.classList.remove('scroll-lock'));
document.getElementById('dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeDialog(); });

function formatTime(at) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(at);
}
function quickLinkCard(item, index, favorite = false) {
  const mark = /^DuckDuckGo$/i.test(item.title) ? svgIcon('search') : escapeHtml(item.icon || item.title.slice(0, 1).toUpperCase());
  const saved = state.data.favorites.some((entry) => entry.url === item.url);
  return `<a class="link-card" href="#" role="button" data-action="visit" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(item.title)}" data-link-index="${index}" aria-label="Browse ${escapeHtml(item.title)} through the secure proxy"><span class="link-symbol" aria-hidden="true">${mark}</span><span class="link-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.host || hostOf(item.url))}</span></span><button class="link-favorite${saved ? ' is-saved' : ''}" type="button" data-action="favorite" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(item.title)}" aria-label="${saved ? 'Remove from' : 'Add to'} favorites" aria-pressed="${saved}">${saved ? '★' : '☆'}</button></a>`;
}
function renderHome() {
  const links = [...DEFAULT_LINKS, ...state.data.customLinks].slice(0, 12);
  const favorites = state.data.favorites.slice(0, 8);
  const visits = state.data.recent.slice(0, 6);
  const linksMarkup = links.length ? `<div class="link-grid">${links.map((item, i) => quickLinkCard(item, i)).join('')}</div>` : '<div class="empty-state">Your shortcuts will show up here.</div>';
  const favoritesMarkup = `<div class="link-grid">${favorites.map((item, i) => quickLinkCard(item, i, true)).join('')}</div>`;
  const recentMarkup = `<div class="recent-list">${visits.map((item) => `<a href="#" class="recent-row" data-action="visit" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(item.title)}"><span class="recent-favicon">${escapeHtml((item.host || '?').slice(0, 1).toUpperCase())}</span><span class="recent-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.host)}</span></span><span class="recent-time">${formatTime(item.at)}</span></a>`).join('')}</div>`;
  return `<section class="hero-page" aria-labelledby="home-title"><h1 class="hero-brand" id="home-title">GoonCore</h1><p class="hero-tagline">your private corner of the web</p><form class="hero-search" data-form="search"><div class="search-box"><span class="search-mark">${svgIcon('search')}</span><input class="search-input" name="q" type="search" autocomplete="off" placeholder="Search or enter URL" aria-label="Search the web or enter a website address" required><button class="search-submit" type="submit">Search <span aria-hidden="true">↗</span></button></div><div class="hero-search-foot"><span>Private search, powered by DuckDuckGo</span><span><kbd class="inline-kbd">/</kbd> to focus</span></div></form><div class="hero-shortcuts" aria-label="Shortcuts"><button class="hero-shortcut" type="button" data-action="focus-search">${svgIcon('search')}<span>Search</span></button><button class="hero-shortcut" type="button" data-page="games">${svgIcon('games')}<span>Games</span></button><button class="hero-shortcut" type="button" data-action="toggle-home-details" aria-expanded="false" aria-controls="home-details">${svgIcon('star')}<span>Apps</span></button></div><div class="home-details" id="home-details" aria-label="Saved shortcuts and browsing activity"><section class="section" aria-labelledby="shortcuts-title"><div class="section-heading"><h2 id="shortcuts-title">Your shortcuts</h2><button class="section-link" type="button" data-action="add-link"><span aria-hidden="true">＋</span> Add your own</button></div>${linksMarkup}</section>${favorites.length ? `<section class="section" aria-labelledby="favorites-title"><div class="section-heading"><h2 id="favorites-title">Favorites</h2><span class="section-note">Saved just for you</span></div>${favoritesMarkup}</section>` : ''}${visits.length ? `<section class="section" aria-labelledby="recent-title"><div class="section-heading"><h2 id="recent-title">Back where you left off</h2><button class="section-link" type="button" data-action="clear-recent">Clear history</button></div>${recentMarkup}</section>` : ''}</div></section>`;
}
function renderLoading() {
  document.getElementById('app-main').innerHTML = '<div class="loading-page"><span class="spinner" aria-hidden="true"></span><span>Getting your space ready…</span></div>';
}
function updateNav(page) {
  for (const item of document.querySelectorAll('.nav-item[data-page]')) {
    const active = item.dataset.page === page;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  }
}
async function navigate(page, params = {}, { updateHash = true, focus = false } = {}) {
  if (!(page in PAGES)) return;
  const mountedMain = document.getElementById('app-main');
  mountedMain.__cleanup?.();
  mountedMain.__cleanup = undefined;
  currentPage = page;
  const title = PAGES[page];
  setTitle(title);
  updateNav(page);
  if (updateHash && window.location.hash !== `#${page}`) history.pushState({ page }, '', `#${page}`);
  const main = document.getElementById('app-main');
  main.setAttribute('aria-busy', 'true');
  const sequence = ++renderSequence;
  if (page === 'home') { main.innerHTML = renderHome(); main.removeAttribute('aria-busy'); } else renderLoading();
  if (page !== 'home') {
    try {
      const modules = { web: () => import('./web.js'), games: () => import('./games.js'), movies: () => import('./movies.js'), settings: () => import('./settings.js') };
      const module = await modules[page]();
      if (sequence !== renderSequence) return;
      const markup = await module.mount(context, params);
      if (sequence !== renderSequence) return;
      main.innerHTML = markup;
      module.activate?.(context, main, params);
    } catch (error) {
      if (sequence !== renderSequence) return;
      main.innerHTML = `<section class="empty-state" role="alert"><strong>This page could not be loaded.</strong><p>${escapeHtml(error?.message || 'Try refreshing the page.')}</p></section>`;
    }
  }
  main.removeAttribute('aria-busy');
  if (focus) main.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: state.settings.lowPerformance || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  animation.width = 0;
  updateAnimation();
}

function showShortcuts() {
  openDialog('A few handy shortcuts', `<p>A keyboard shortcut for the things you do most.</p><div class="shortcut-list"><div class="shortcut-row"><span>Jump to a page</span><kbd>⌘ / Ctrl + 1 – 5</kbd></div><div class="shortcut-row"><span>Focus search</span><kbd>/ or ⌘ / Ctrl + K</kbd></div><div class="shortcut-row"><span>Open this guide</span><kbd>?</kbd></div><div class="shortcut-row"><span>Close a dialog / menu</span><kbd>Esc</kbd></div><div class="shortcut-row"><span>Play 2048 / Snake</span><kbd>Arrow keys</kbd></div></div>`);
}
function showAddLink() {
  openDialog('Add a shortcut', `<p>Save a place you would like close by.</p><form class="dialog-form" data-form="add-link"><label for="new-link-title">A name<input id="new-link-title" name="title" class="setting-text" maxlength="42" placeholder="My favorite corner of the web" required autofocus></label><label for="new-link-url">Website address<input id="new-link-url" name="url" class="setting-text" placeholder="https://example.com" inputmode="url" maxlength="500" required></label><div class="dialog-actions"><button type="button" class="secondary-button" data-action="close-dialog">Not now</button><button type="submit" class="primary-button">Add shortcut</button></div></form>`);
}
function onDocumentClick(event) {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) { navigate(pageButton.dataset.page, {}, { focus: true }); return; }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  if (action.dataset.action === 'shortcuts') showShortcuts();
  else if (action.dataset.action === 'open-web') {
    event.preventDefault();
    goToWeb(action.dataset.url || action.href);
  }
  else if (action.dataset.action === 'close-dialog') closeDialog();
  else if (action.dataset.action === 'add-link') showAddLink();
  else if (action.dataset.action === 'focus-search') document.querySelector('#app-main input[type="search"]')?.focus();
  else if (action.dataset.action === 'toggle-home-details') {
    const details = document.getElementById('home-details');
    const open = !details.classList.contains('is-open');
    details.classList.toggle('is-open', open);
    action.setAttribute('aria-expanded', String(open));
    if (open) requestAnimationFrame(() => details.scrollIntoView({ behavior: state.settings.lowPerformance ? 'instant' : 'smooth', block: 'start' }));
  }
  else if (action.dataset.action === 'clear-recent') {
    state.data.recent = [];
    persistData();
    navigate('home', {}, { updateHash: false });
    showToast('Browsing history cleared from this device.');
  } else if (action.dataset.action === 'favorite') {
    event.preventDefault();
    event.stopPropagation();
    const saved = toggleFavorite({ url: action.dataset.url, title: action.dataset.title, host: hostOf(action.dataset.url) });
    action.classList.toggle('is-saved', saved);
    action.setAttribute('aria-pressed', String(saved));
    action.setAttribute('aria-label', `${saved ? 'Remove from' : 'Add to'} favorites`);
    action.textContent = saved ? '★' : '☆';
    showToast(saved ? 'Saved to favorites.' : 'Removed from favorites.');
  } else if (action.dataset.action === 'visit') {
    event.preventDefault();
    if (event.target.closest('[data-action="favorite"]')) return;
    if (action.dataset.url) goToWeb(action.dataset.url);
  }
}
function onDocumentSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === 'search') {
    const query = new FormData(form).get('q')?.toString() || '';
    if (looksLikeWebsite(query)) goToWeb(query);
    else openSearch(query);
  } else if (form.dataset.form === 'add-link') {
    const formData = new FormData(form);
    const title = String(formData.get('title') || '').trim().slice(0, 42);
    const url = canonicalUrl(formData.get('url'));
    if (!title || !url) { showToast('Enter a name and a valid HTTP or HTTPS website.', 'error'); return; }
    if (DEFAULT_LINKS.concat(state.data.customLinks).some((item) => item.url === url)) { showToast('That shortcut is already on your home page.', 'error'); return; }
    state.data.customLinks.unshift({ id: `custom-${Date.now()}`, title, host: hostOf(url), url, icon: '↗' });
    state.data.customLinks = state.data.customLinks.slice(0, 12);
    persistData();
    closeDialog();
    navigate('home', {}, { updateHash: false });
    showToast('Shortcut added to your home page.');
  }
}
document.addEventListener('click', onDocumentClick);
document.addEventListener('submit', onDocumentSubmit);
window.addEventListener('hashchange', () => { const page = location.hash.slice(1); if (page in PAGES && page !== currentPage) navigate(page, {}, { updateHash: false, focus: true }); });
window.addEventListener('popstate', () => { const page = location.hash.slice(1); if (page in PAGES && page !== currentPage) navigate(page, {}, { updateHash: false, focus: true }); });
document.addEventListener('keydown', (event) => {
  const command = event.metaKey || event.ctrlKey;
  const target = event.target;
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
  if (command && ['1', '2', '3', '4', '5'].includes(event.key)) {
    event.preventDefault();
    navigate(Object.keys(PAGES)[Number(event.key) - 1], {}, { focus: true });
  } else if (command && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    (document.querySelector('#app-main input[type="search"]') || document.querySelector('#app-main input')).focus();
  } else if (event.key === '/' && !editing && !document.getElementById('dialog').open) {
    event.preventDefault();
    (document.querySelector('#app-main input[type="search"]') || document.querySelector('#app-main input'))?.focus();
  } else if (event.key === '?' && !editing && !document.getElementById('dialog').open) showShortcuts();
});
window.addEventListener('gooncore:favorites', () => { if (currentPage === 'home') navigate('home', {}, { updateHash: false }); });

applySettings();  const initialPage = location.hash.slice(1);
  navigate(initialPage in PAGES ? initialPage : 'home', {}, { updateHash: !location.hash });
