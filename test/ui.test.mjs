import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fromRoot = (file) => new URL(`../${file}`, import.meta.url);
const appSource = await readFile(fromRoot('public/app.js'), 'utf8');
const indexSource = await readFile(fromRoot('public/index.html'), 'utf8');
const stylesSource = await readFile(fromRoot('public/styles.css'), 'utf8');
const webSource = await readFile(fromRoot('public/web.js'), 'utf8');
const gamesSource = await readFile(fromRoot('public/games.js'), 'utf8');
const moviesSource = await readFile(fromRoot('public/movies.js'), 'utf8');
const settingsSource = await readFile(fromRoot('public/settings.js'), 'utf8');
const serverSource = await readFile(fromRoot('server.mjs'), 'utf8');

async function moduleAt(file) { return import(fromRoot(file).href); }

function context(overrides = {}) {
  const settings = { movieEmbedUrl: 'https://provider.example/embed', safeSearch: 'moderate', region: '' };
  return {
    settings,
    data: { recent: [], favoriteGames: [], recentGames: [] },
    icon: () => '<svg aria-hidden="true"></svg>',
    esc: (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    ...overrides,
  };
}

test('Home search routes queries to Web and accepts public URLs', () => {
  assert.match(appSource, /function openSearch\(query\)[\s\S]*?navigate\('web', \{ query: safe \}\)/);
  assert.match(appSource, /if \(!looksLikeWebsite\(raw\)\) \{ openSearch\(raw\); return; \}/);
  assert.match(appSource, /if \(looksLikeWebsite\(query\)\) goToWeb\(query\);\s*else openSearch\(query\);/);
  assert.match(appSource, /navigate\('web', \{ url \}\)/);
  assert.match(webSource, /fetch\(ctx\.searchUrl\(query\)/);
  assert.match(webSource, /goTo\(await resolveSearch\(ctx, parsed\.query/);
  assert.doesNotMatch(appSource, /window\.open\s*\(/);
  assert.doesNotMatch(webSource, /window\.open\s*\(/);
  assert.doesNotMatch(`${appSource}\n${webSource}\n${gamesSource}\n${moviesSource}`, /target=["']_blank/i);
});

test('Games is a native catalog and embeds only one individual game after a server permission check', async () => {
  const module = await moduleAt('public/games.js');
  const html = await module.mount(context());
  assert.match(html, /data-catalog-grid/);
  assert.match(html, /data-catalog-search/);
  assert.match(html, /Recently played/);
  assert.match(html, /data-catalog-sort/);
  assert.match(gamesSource, /const id = htmlEscape\(game\.id\);[\s\S]*?data-game-launch="\$\{id\}"/);
  assert.match(gamesSource, /data-game-frame/);
  assert.doesNotMatch(gamesSource, /data-player-gate|data-player-authorize|authorized to play this title/i);
  assert.match(gamesSource, /if \(game\) loadGame\(game\);/);
  assert.doesNotMatch(html, /data-gn-frame|gn-math\.dev|gameUrl[^<]*<iframe/i);
  assert.match(gamesSource, /\/api\/games/);
  assert.match(gamesSource, /\/api\/embed-check\?url=/);
  assert.match(gamesSource, /loading="lazy"/);
  assert.match(gamesSource, /GAMES_PER_PAGE = 60/);
  assert.match(gamesSource, /data-catalog-pagination/);
  assert.match(gamesSource, /renderPagination/);
  assert.match(stylesSource, /\.catalog-page-button/);
  assert.match(stylesSource, /\.catalog-page-button\.is-active/);
  assert.doesNotMatch(gamesSource, /data-catalog-more|Show more games/);
  assert.match(gamesSource, /memoryCache/);
  assert.match(gamesSource, /setImmersive/);
  assert.match(serverSource, /raw\.githubusercontent\.com\/gn-math\/assets\/main\/zones\.json/);
  assert.match(serverSource, /raw\.githubusercontent\.com\/gn-math\/covers\/main/);
  assert.match(serverSource, /gn-math\.github\.io\/html/);
  assert.match(gamesSource, /COVER_BASE = 'https:\/\/raw\.githubusercontent\.com\/gn-math\/covers\/main\/'/);
  assert.match(gamesSource, /GAME_BASE = 'https:\/\/gn-math\.github\.io\/html\/'/);
  assert.match(gamesSource, /gooncore\.games\.catalog\.v2/);
  assert.doesNotMatch(gamesSource, /jsdelivr/);
  assert.match(serverSource, /Some hosts answer HEAD with an error/);
  assert.match(serverSource, /export function normalizeGameCatalog/);
  assert.match(serverSource, /GAME_CATALOG_TIMEOUT_MS = 12_000/);
  assert.match(serverSource, /request\.once\('error', \(error\) => \{ cleanup\(\); reject\(error\); \}\)/);
});

test('Movies is a large lazy in-app provider player with explicit load, error, stop and fullscreen controls', async () => {
  const module = await moduleAt('public/movies.js');
  const html = await module.mount(context());
  assert.match(html, /movie-room/);
  assert.match(html, /data-movie-frame/);
  assert.match(html, /data-movie-loading/);
  assert.match(html, /data-movie-error/);
  assert.match(html, /data-movie-fullscreen/);
  assert.match(html, /data-movie-stop/);
  assert.match(html, /data-movie-load/);
  assert.doesNotMatch(html, /\bsrc="https:/i);
  assert.doesNotMatch(html, /data-movie-fallback|window\.open|target=["']_blank/i);
  assert.match(moviesSource, /\/api\/embed-check\?url=/);
  assert.match(moviesSource, /DEFAULT_MOVIE_PROVIDER = 'https:\/\/zxcstream\.icu\/'/);
  assert.match(moviesSource, /requestFullscreen/);
  assert.match(moviesSource, /setImmersive/);
  assert.match(moviesSource, /blockedHost/);
  assert.doesNotMatch(moviesSource, /No provider configured|Configure provider/);
  assert.doesNotMatch(html.match(/<iframe[^>]*data-movie-frame[^>]*>/i)[0], /sandbox/i);
  assert.match(html.match(/<iframe[^>]*data-movie-frame[^>]*>/i)[0], /allow="fullscreen/);
  assert.match(settingsSource, /data-movie-embed-url/);
  assert.match(appSource, /movieEmbedUrl: 'https:\/\/zxcstream\.icu\/'/);
  assert.doesNotMatch(moviesSource, /api\/movies|TMDb|tmdb|poster/i);
});

test('Proxy has in-app controls, safe same-origin search and history-aware sandboxed documents', () => {
  assert.match(webSource, /data-history-back/);
  assert.match(webSource, /data-history-forward/);
  assert.match(webSource, /data-proxy-reload/);
  assert.match(webSource, /data-proxy-home/);
  assert.match(webSource, /ctx\.navigate\('web', \{ url: href, history: entries, historyIndex: index \}/);
  assert.match(webSource, /sandbox="allow-scripts allow-forms"/);
  assert.match(webSource, /gooncore:proxy-redirect/);
  assert.match(webSource, /window\.removeEventListener\('message', onFrameMessage\)/);
  assert.match(webSource, /event\.origin !== 'null'/);
  assert.match(serverSource, /<iframe\\b\(\[\^>\]\*\)>/);
  assert.match(serverSource, /function sandboxIframe/);
  assert.match(serverSource, /srcdocValues\.forEach/);
  assert.match(webSource, /only standard public HTTP and HTTPS ports/);
  assert.match(serverSource, /15-second total limit/);
  assert.match(webSource, /data-proxy-fullscreen/);
  assert.match(webSource, /classList\.add\('web-fullscreen'\)/);
  assert.match(stylesSource, /\.web-fullscreen \.proxy-browser \{ position: fixed; inset: 0/);
  assert.match(stylesSource, /\.web-fullscreen #app-main \{ animation: none; \}/);
  assert.match(webSource, /onFullscreenKey/);
  // The relayed document and its container must share one height, otherwise the panel paints an
  // empty band below the frame.
  assert.equal((stylesSource.match(/\.proxy-iframe \{/g) || []).length, 1);
  assert.match(stylesSource, /\.proxy-iframe \{[^}]*height: var\(--proxy-height\)/);
  assert.match(stylesSource, /\.proxy-browser-content \{[^}]*min-height: var\(--proxy-height\)/);
  // The frame height must track the window: a fixed cap leaves a dead band below the panel on tall
  // screens, and a full-screen panel must fill the display rather than stopping at the cap.
  assert.match(stylesSource, /--proxy-height: max\(360px,calc\(100vh - 320px\)\)/);
  assert.match(stylesSource, /\.proxy-browser:fullscreen \{ position: fixed; inset: 0;[^}]*height: 100vh/);
  assert.match(stylesSource, /\.proxy-browser:fullscreen \.proxy-iframe[^{]*\{ height: 100%/);
  assert.match(serverSource, /function decodeAttributeValue/);
  assert.match(serverSource, /function clientRedirectDocument/);
  assert.match(serverSource, /export function clientRedirectTarget/);
  assert.match(serverSource, /const value = decodeAttributeValue\(reference\)\.trim\(\)/);
  assert.doesNotMatch(webSource, /window\.open\s*\(/);
});

test('the search engine is selectable, defaults to DuckDuckGo and reaches the server with the query', () => {
  assert.match(appSource, /searchEngine: 'duckduckgo'/);
  assert.match(appSource, /searchEngine: \['duckduckgo','google','bing','brave'\]/);
  assert.match(appSource, /engine: state\.settings\.searchEngine/);
  // The engine list is a dropdown, and every option must survive the same allowlist the settings
  // layer enforces so a chosen engine is never silently dropped.
  assert.match(settingsSource, /const ENGINES = \[\n\s*\['duckduckgo', 'DuckDuckGo · default'\],\n\s*\['google', 'Google'\],\n\s*\['bing', 'Bing'\],\n\s*\['brave', 'Brave'\],\n\];/);
  assert.match(settingsSource, /<select class="setting-select" data-select="searchEngine"/);
  assert.match(settingsSource, /ctx\.toast\(`Search engine set to \$/);
  assert.match(settingsSource, /searchEngine: 'duckduckgo'/);
  assert.match(serverSource, /export function searchDestination/);
});

test('an empty Web page still renders the loading, error and frame nodes so a typed search can run', async () => {
  const web = await moduleAt('public/web.js');
  const empty = await web.mount(context());
  assert.match(empty, /data-proxy-empty/);
  assert.match(empty, /data-proxy-loading/);
  assert.match(empty, /data-proxy-error/);
  assert.match(empty, /data-proxy-frame/);
  assert.match(empty, /<div class="proxy-loading" data-proxy-loading role="status" hidden>/);
  const searching = await web.mount(context(), { query: 'quiet web' });
  assert.doesNotMatch(searching, /data-proxy-empty/);
  assert.match(searching, /<div class="proxy-loading" data-proxy-loading role="status">/);
  assert.match(webSource, /const showLoading = \(\) => \{[\s\S]*?empty\.hidden = true/);
});

test('canvas particles fall downward and rain uses a heavier, faster velocity than the drifting effects', () => {
  // Snow (and rain) must travel down the screen: the draw loop used to subtract the velocity for
  // snow, which made the flakes rise. Snow wraps out of the bottom and back in at the top.
  assert.match(appSource, /type === 'snow'[\s\S]*?p\.y \+= p\.dy \* dt \* speed;[\s\S]*?if \(p\.y > h \+ 3\) p\.y = -3;/);
  assert.doesNotMatch(appSource, /p\.y -= p\.dy \* dt \* speed \* \(type === 'snow'/);
  assert.match(appSource, /type === 'particles'[\s\S]*?p\.y -= p\.dy \* \.16 \* dt \* speed;[\s\S]*?if \(p\.y < -3\) p\.y = h \+ 3;/);
  // Rain streaks are the fast effect; the range is what "make the rain faster" tunes.
  assert.match(appSource, /effect === 'rain' \? 5\.4 : effect === 'snow' \? 0\.22 : 0\.05, effect === 'rain' \? 12 :/);
  // Switching effect at runtime has to rebuild the particle set, otherwise snow keeps the rain's
  // falling speed (and rain keeps snow's), because the velocity ranges are chosen at build time.
  assert.match(appSource, /if \(animation\.effect !== state\.settings\.background\) \{\n\s*animation\.effect = state\.settings\.background;\n\s*animation\.width = 0;/);
  assert.match(appSource, /let animation = \{ raf: 0, resize: null, particles: \[\], lastFrame: 0, width: 0, height: 0, dpr: 1, reduced: false, intersection: true, effect: '' \}/);
});

test('layout remains responsive and centered with lazy native-games and fullscreen-player styling', () => {
  assert.match(indexSource, /GoonCore navigation/);
  assert.match(indexSource, /<main id="app-main"/);
  assert.match(stylesSource, /#app-main \{[^}]*max-width: var\(--content-width\)[^}]*margin: 0 auto/s);
  assert.match(stylesSource, /\.topbar[^}]*left: 50%[^}]*transform: translateX\(-50%\)/s);
  assert.match(stylesSource, /#background-canvas \{[^}]*position: fixed; inset: 0/s);
  assert.match(stylesSource, /@media \(max-width: 480px\)/);
  assert.match(stylesSource, /@media \(min-width: 1800px\)/);
  assert.match(stylesSource, /\.game-catalog-grid/);
  assert.match(stylesSource, /\.catalog-card-launch:focus-visible/);
  assert.match(stylesSource, /\.movie-screen-frame:not\(\[hidden\]\)/);
  assert.match(stylesSource, /\.movie-room/);
  assert.match(stylesSource, /\.native-game-frame/);
  assert.doesNotMatch(stylesSource, /margin-left:\s*50vw/);
});
