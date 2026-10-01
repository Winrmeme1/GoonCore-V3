const CATEGORIES = ['All games', 'Action', 'Adventure', 'Arcade', 'Puzzle', 'Racing', 'Sports', 'Favorites', 'Recently played'];
const CATALOG_URL = '/api/games';
const CACHE_KEY = 'gooncore.games.catalog.v2';
// jsDelivr blocked the whole gn-math user, so the catalog now serves games from org Pages and covers
// from raw GitHub content. These allowlists must stay in step with the server's normalizeGameCatalog.
const COVER_BASE = 'https://raw.githubusercontent.com/gn-math/covers/main/';
const GAME_BASE = 'https://gn-math.github.io/html/';
const CACHE_TTL = 6 * 60 * 60 * 1000;
const GAMES_PER_PAGE = 60;
const memoryCache = { games: null, fetchedAt: 0 };
const htmlEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function validCoverUrl(value) {
  return typeof value === 'string' && value.length <= 2048 && value.startsWith(COVER_BASE)
    && /^[\w.-]+\.(?:png|jpe?g|webp)$/i.test(value.slice(COVER_BASE.length));
}
function validGameUrl(value) {
  return typeof value === 'string' && value.length <= 2048 && value.startsWith(GAME_BASE)
    && /^[\w.-]+\.html?$/i.test(value.slice(GAME_BASE.length));
}
function validEntry(game) {
  return game && typeof game.id === 'string' && /^\d{1,12}$/.test(game.id)
    && typeof game.title === 'string' && game.title.trim().length > 0 && game.title.length <= 140
    && typeof game.category === 'string' && ['Action', 'Adventure', 'Arcade', 'Puzzle', 'Racing', 'Sports'].includes(game.category)
    && typeof game.source === 'string' && game.source.length <= 80
    && typeof game.featured === 'boolean'
    && validCoverUrl(game.cover) && validGameUrl(game.gameUrl);
}

function loadSavedCatalog() {
  if (Array.isArray(memoryCache.games) && Date.now() - memoryCache.fetchedAt < CACHE_TTL) return memoryCache;
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (Array.isArray(saved?.games) && saved.games.length > 0 && Number.isFinite(saved.savedAt) && saved.savedAt <= Date.now()
        && Date.now() - saved.savedAt < CACHE_TTL && saved.games.every(validEntry)) {
      memoryCache.games = saved.games;
      memoryCache.fetchedAt = saved.savedAt;
      return memoryCache;
    }
  } catch {}
  return null;
}
function saveCatalog(games, cachedAt) {
  const parsedAt = Date.parse(cachedAt);
  memoryCache.games = games;
  memoryCache.fetchedAt = Date.now();
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      savedAt: memoryCache.fetchedAt,
      sourceFetchedAt: Number.isFinite(parsedAt) ? parsedAt : null,
      games,
    }));
  } catch {}
}
async function loadCatalog(signal) {
  const saved = loadSavedCatalog();
  if (saved) return { games: saved.games, cached: true };
  const response = await fetch(CATALOG_URL, { signal, cache: 'default', headers: { Accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.games)) throw new Error(data.error || 'The game catalog is unavailable.');
  const games = data.games.filter(validEntry);
  if (!games.length) throw new Error('The public catalog did not contain any supported individual HTML games.');
  saveCatalog(games, data.cachedAt);
  return { games, cached: Boolean(data.stale) };
}

function cardMarkup(game, favorites, recent) {
  const isFavorite = favorites.includes(game.id);
  const played = recent.some((item) => item.id === game.id);
  const title = htmlEscape(game.title);
  const id = htmlEscape(game.id);
  const cover = htmlEscape(game.cover);
  return `<article class="catalog-card" data-game-card data-game-id="${id}">
    <button class="catalog-card-launch" type="button" data-game-launch="${id}" aria-label="Play ${title}">
      <span class="catalog-cover-wrap"><img class="catalog-cover" src="${cover}" alt="" width="320" height="180" loading="lazy" decoding="async" fetchpriority="low"><span class="catalog-cover-fallback" aria-hidden="true">${title.slice(0, 1).toUpperCase()}</span><span class="catalog-play-indicator" aria-hidden="true">▶</span></span>
      <span class="catalog-card-title">${title}</span>
    </button>
    <span class="catalog-card-meta">${htmlEscape(game.category)}${played ? ' · Played' : ''}${game.featured ? ' · Featured' : ''}</span>
    <button type="button" class="catalog-favorite${isFavorite ? ' is-saved' : ''}" data-game-favorite="${id}" aria-label="${isFavorite ? 'Remove' : 'Add'} ${title} ${isFavorite ? 'from' : 'to'} favorites" aria-pressed="${isFavorite}">${isFavorite ? '★' : '☆'}</button>
  </article>`;
}

function gamePlayerMarkup(ctx) {
  return `<section class="native-game-player" data-game-player aria-label="GoonCore game player" hidden>
    <header class="native-game-player-header"><div class="native-game-title-wrap"><button type="button" class="secondary-button" data-game-back>← Library</button><div><p class="eyebrow">ONE GAME · ISOLATED PLAYER</p><h2 data-player-title>Game</h2></div></div><div class="native-game-player-actions"><button type="button" class="icon-button" data-game-fullscreen aria-label="Fullscreen game" title="Fullscreen" disabled>⛶</button><button type="button" class="icon-button" data-game-close aria-label="Close game" title="Close">×</button></div></header>
    <div class="native-game-screen" data-player-screen><div class="game-player-state" data-player-loading role="status" hidden><span class="spinner" aria-hidden="true"></span><strong>Checking this game’s embed permission…</strong><p>Only this individual title will load.</p></div><div class="game-player-state" data-player-error role="alert" hidden><span class="proxy-empty-icon" aria-hidden="true">${ctx.icon('shield')}</span><strong data-player-error-title>This game cannot be embedded</strong><p data-player-error-message>The individual game or one of its required sources refused the embed. No frame policy is bypassed.</p><button type="button" class="secondary-button" data-player-retry>Try again</button></div><iframe class="native-game-frame" data-game-frame title="Individual game" referrerpolicy="no-referrer" loading="lazy" allow="fullscreen; autoplay; gamepad; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-orientation-lock" hidden></iframe></div>
    <footer class="native-game-footer"><span data-player-status>Choose a title · each game is permission-checked and sandboxed before it loads</span><span>Game data remains isolated from GoonCore</span></footer>
  </section>`;
}

export function mount(ctx) {
  return `<header class="page-intro game-library-intro"><div><p class="eyebrow"><span class="privacy-indicator"></span>THE GOONCORE ARCADE</p><h1>Games</h1><p>A compact library of individual HTML games. Launch one title at a time, without the source-site chrome.</p></div><span class="game-source-badge">COMMUNITY CATALOG</span></header>
    ${gamePlayerMarkup(ctx)}
    <section class="game-library" aria-label="Game library">
      <div class="game-library-toolbar"><label class="search-box game-library-search"><span class="search-mark">${ctx.icon('search')}</span><input class="search-input" data-catalog-search type="search" maxlength="100" autocomplete="off" placeholder="Search the library…" aria-label="Search the game library"><button type="button" class="icon-button catalog-clear" data-catalog-clear aria-label="Clear game search" hidden>×</button></label><label class="game-sort-control"><span>Sort</span><select class="setting-select" data-catalog-sort aria-label="Sort games"><option value="popular">Featured &amp; catalog order</option><option value="title-asc">Title · A–Z</option><option value="title-desc">Title · Z–A</option></select></label><span class="catalog-count" data-catalog-count>Loading catalog…</span></div>
      <nav class="game-category-row" data-game-categories aria-label="Game categories">${CATEGORIES.map((category) => `<button type="button" class="game-category-chip${category === 'All games' ? ' is-active' : ''}" data-category="${htmlEscape(category)}" aria-pressed="${category === 'All games'}">${htmlEscape(category)}</button>`).join('')}</nav>
      <div class="game-catalog-state" data-catalog-loading role="status"><span class="spinner" aria-hidden="true"></span><span>Loading the game list…</span></div>
      <div class="game-catalog-state" data-catalog-error role="alert" hidden><strong>Couldn’t load the game catalog</strong><p data-catalog-error-message>The public manifest could not be reached. Try again shortly.</p><button type="button" class="secondary-button" data-catalog-retry>Try again</button></div>
      <div class="game-catalog-grid" data-catalog-grid aria-live="polite"></div>
      <nav class="catalog-pagination" data-catalog-pagination aria-label="Game pages" hidden></nav>
      <footer class="game-library-footer"><span data-catalog-source>Catalog fetched only when Games opens · individual game sources checked before launch</span><span data-catalog-play-count></span></footer>
    </section>`;
}

export function activate(ctx, main) {
  const grid = main.querySelector('[data-catalog-grid]');
  const loading = main.querySelector('[data-catalog-loading]');
  const error = main.querySelector('[data-catalog-error]');
  const count = main.querySelector('[data-catalog-count]');
  const search = main.querySelector('[data-catalog-search]');
  const sort = main.querySelector('[data-catalog-sort]');
  const categories = main.querySelector('[data-game-categories]');
  const pagination = main.querySelector('[data-catalog-pagination]');
  const player = main.querySelector('[data-game-player]');
  const frame = main.querySelector('[data-game-frame]');
  const playerLoading = main.querySelector('[data-player-loading]');
  const playerError = main.querySelector('[data-player-error]');
  const fullscreen = main.querySelector('[data-game-fullscreen]');
  const pageController = new AbortController();
  let playerController;
  let loadTimer;
  let games = [];
  let selectedCategory = 'All games';
  let currentPage = 1;
  let totalPages = 1;
  let disposed = false;
  let playingId = '';

  const setImmersive = (value) => {
    document.documentElement.classList.toggle('game-playing', value);
    ctx.setImmersive?.(value);
  };
  const visibleGames = () => {
    const query = String(search.value || '').trim().toLocaleLowerCase();
    let list = games.filter((game) => !query || `${game.title} ${game.category}`.toLocaleLowerCase().includes(query));
    if (selectedCategory === 'Favorites') list = list.filter((game) => ctx.data.favoriteGames.includes(game.id));
    else if (selectedCategory === 'Recently played') {
      const recent = ctx.data.recentGames.map((item) => item.id);
      list = list.filter((game) => recent.includes(game.id)).sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    } else if (selectedCategory !== 'All games') list = list.filter((game) => game.category === selectedCategory);
    if (sort.value === 'title-asc') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort.value === 'title-desc') list.sort((a, b) => b.title.localeCompare(a.title));
    else if (selectedCategory !== 'Recently played') list.sort((a, b) => Number(b.featured) - Number(a.featured));
    return list;
  };
  const pageItems = (current, total) => {
    const wanted = new Set([1, total, current, current - 1, current - 2, current + 1, current + 2]);
    const pages = [...wanted].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
    const items = [];
    let previous = 0;
    for (const page of pages) {
      if (previous && page - previous > 1) items.push('gap');
      items.push(page);
      previous = page;
    }
    return items;
  };
  const renderPagination = (total) => {
    if (!pagination) return;
    if (total <= 1) { pagination.hidden = true; pagination.replaceChildren(); return; }
    const step = (label, page, disabled) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button catalog-page-step';
      button.dataset.catalogPage = String(page);
      button.textContent = label;
      button.disabled = disabled;
      return button;
    };
    const nodes = [step('← Previous', currentPage - 1, currentPage === 1)];
    for (const item of pageItems(currentPage, total)) {
      if (item === 'gap') {
        const gap = document.createElement('span');
        gap.className = 'catalog-page-gap';
        gap.setAttribute('aria-hidden', 'true');
        gap.textContent = '…';
        nodes.push(gap);
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `catalog-page-button${item === currentPage ? ' is-active' : ''}`;
      button.dataset.catalogPage = String(item);
      button.textContent = String(item);
      button.setAttribute('aria-label', `Page ${item}`);
      if (item === currentPage) button.setAttribute('aria-current', 'page');
      nodes.push(button);
    }
    nodes.push(step('Next →', currentPage + 1, currentPage === total));
    pagination.hidden = false;
    pagination.replaceChildren(...nodes);
  };
  const renderLibrary = () => {
    const filtered = visibleGames();
    const total = filtered.length;
    totalPages = Math.max(1, Math.ceil(total / GAMES_PER_PAGE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const shown = filtered.slice((currentPage - 1) * GAMES_PER_PAGE, currentPage * GAMES_PER_PAGE);
    grid.innerHTML = shown.length ? shown.map((game) => cardMarkup(game, ctx.data.favoriteGames, ctx.data.recentGames)).join('') : `<div class="game-catalog-empty"><strong>${selectedCategory === 'Favorites' ? 'No favorite games yet.' : selectedCategory === 'Recently played' ? 'No recently played games yet.' : 'No games match that search.'}</strong><span>${selectedCategory === 'Favorites' || selectedCategory === 'Recently played' ? 'Save or launch a title to see it here.' : 'Try a shorter search or a different category.'}</span></div>`;
    count.textContent = `${total.toLocaleString()} ${total === 1 ? 'game' : 'games'}${totalPages > 1 ? ` · page ${currentPage} of ${totalPages}` : ''}`;
    renderPagination(totalPages);
    main.querySelector('[data-catalog-source]').textContent = 'Source: GN Math public assets catalog · individual URLs and artwork allowlisted';
    main.querySelector('[data-catalog-play-count]').textContent = `${ctx.data.recentGames.length} recently played`;
    grid.querySelectorAll('.catalog-cover').forEach((image) => image.addEventListener('error', () => {
      image.closest('.catalog-cover-wrap')?.classList.add('cover-unavailable');
      image.remove();
    }, { once: true }));
  };
  const setPlayerError = (message) => {
    if (disposed || playerController?.signal.aborted) return;
    clearTimeout(loadTimer);
    playerController?.abort();
    frame.removeAttribute('src');
    frame.hidden = true;
    playerLoading.hidden = true;
    playerError.hidden = false;
    main.querySelector('[data-player-error-title]').textContent = 'This game cannot be embedded';
    main.querySelector('[data-player-error-message]').textContent = String(message || 'The game source refused embedding.').slice(0, 700);
    main.querySelector('[data-player-status]').textContent = 'Embed unavailable · source policy respected';
    fullscreen.disabled = true;
    setImmersive(false);
  };
  const loadGame = async (game) => {
    playerController?.abort();
    playerController = new AbortController();
    clearTimeout(loadTimer);
    playingId = game.id;
    player.hidden = false;
    grid.closest('.game-library').hidden = true;
    playerError.hidden = true;
    playerLoading.hidden = false;
    fullscreen.disabled = true;
    frame.hidden = true;
    frame.removeAttribute('src');
    main.querySelector('[data-player-title]').textContent = game.title;
    main.querySelector('[data-player-status]').textContent = 'Checking source framing permission…';
    try {
      const response = await fetch(`/api/embed-check?url=${encodeURIComponent(game.gameUrl)}`, {
        signal: AbortSignal.any([playerController.signal, AbortSignal.timeout(9000)]),
        cache: 'no-store', headers: { Accept: 'application/json' },
      });
      const result = await response.json();
      if (!response.ok || !result.embeddable) throw new Error(result.error || 'This individual game does not allow embedding.');
      if (disposed || playerController.signal.aborted || !frame.isConnected || playingId !== game.id) return;
      const allowed = new URL(result.url || game.gameUrl);
      const expected = new URL(game.gameUrl);
      let allowedPath;
      try { allowedPath = decodeURIComponent(allowed.pathname); } catch { throw new Error('The game returned an invalid path. The destination has not been loaded.'); }
      if (allowed.href !== expected.href || allowed.protocol !== 'https:' || allowed.hostname !== 'gn-math.github.io'
          || !/^\/html\/[\w.-]+\.html?$/i.test(allowedPath)) throw new Error('The game redirected to a different host or path. The destination has not been loaded.');
      frame.src = allowed.href;
      frame.hidden = false;
      playerLoading.hidden = true;
      main.querySelector('[data-player-status]').textContent = 'Individual game loaded · sandboxed';
      setImmersive(true);
      loadTimer = setTimeout(() => {
        if (!frame.isConnected || frame.hidden || playerController.signal.aborted) return;
        setPlayerError('This title did not finish loading or refused embedded playback. GoonCore will not bypass that restriction.');
      }, 25_000);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      if (disposed || playerController.signal.aborted || cause.name === 'AbortError') return;
      setPlayerError(cause.message);
    }
  };
  const returnToLibrary = () => {
    playerController?.abort();
    clearTimeout(loadTimer);
    frame.removeAttribute('src');
    frame.hidden = true;
    player.hidden = true;
    grid.closest('.game-library').hidden = false;
    playerError.hidden = true;
    playerLoading.hidden = true;
    playingId = '';
    fullscreen.disabled = true;
    setImmersive(false);
    renderLibrary();
  };
  const onFrameLoad = () => {
    if (frame.hidden || disposed || !playerController || playerController.signal.aborted) return;
    clearTimeout(loadTimer);
    fullscreen.disabled = false;
    ctx.playGame(playingId);
    main.querySelector('[data-catalog-play-count]').textContent = `${ctx.data.recentGames.length} recently played`;
    main.querySelector('[data-player-status]').textContent = 'Game frame opened · source content stays isolated';
  };
  const onFrameError = () => {
    if (disposed || !playerController || playerController.signal.aborted || frame.hidden) return;
    setPlayerError('The browser blocked the individual game frame. Its embed security policy has not been changed.');
  };
  const onSearch = () => {
    currentPage = 1;
    main.querySelector('[data-catalog-clear]').hidden = !search.value;
    renderLibrary();
  };
  const onSort = () => { currentPage = 1; renderLibrary(); };
  const onFavoriteEvent = (event) => {
    if (!event.detail?.id) return;
    const button = [...main.querySelectorAll('[data-game-favorite]')].find((item) => item.dataset.gameFavorite === event.detail.id);
    if (button) {
      button.classList.toggle('is-saved', event.detail.saved);
      button.setAttribute('aria-pressed', String(event.detail.saved));
      button.textContent = event.detail.saved ? '★' : '☆';
    }
    if (selectedCategory === 'Favorites') renderLibrary();
  };
  const onClick = (event) => {
    const launch = event.target.closest('[data-game-launch]');
    if (launch) {
      const game = games.find((item) => item.id === launch.dataset.gameLaunch);
      if (game) loadGame(game);
      return;
    }
    const favorite = event.target.closest('[data-game-favorite]');
    if (favorite) {
      const saved = ctx.toggleGameFavorite(favorite.dataset.gameFavorite);
      favorite.classList.toggle('is-saved', saved);
      favorite.setAttribute('aria-pressed', String(saved));
      favorite.textContent = saved ? '★' : '☆';
      favorite.setAttribute('aria-label', `${saved ? 'Remove' : 'Add'} ${games.find((game) => game.id === favorite.dataset.gameFavorite)?.title || 'game'} ${saved ? 'from' : 'to'} favorites`);
      if (selectedCategory === 'Favorites') renderLibrary();
      return;
    }
    const category = event.target.closest('[data-category]');
    if (category) {
      selectedCategory = category.dataset.category;
      currentPage = 1;
      for (const button of categories.querySelectorAll('[data-category]')) {
        const active = button.dataset.category === selectedCategory;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      renderLibrary();
      return;
    }
    if (event.target.closest('[data-catalog-retry]')) { initializeCatalog(true); return; }
    const page = event.target.closest('[data-catalog-page]');
    if (page) {
      const requested = Number(page.dataset.catalogPage);
      if (Number.isInteger(requested) && requested >= 1 && requested <= totalPages && requested !== currentPage) {
        currentPage = requested;
        renderLibrary();
        window.scrollTo({ top: Math.max(0, grid.getBoundingClientRect().top + window.scrollY - 96), behavior: 'smooth' });
      }
      return;
    }
    if (event.target.closest('[data-catalog-clear]')) { search.value = ''; onSearch(); search.focus(); return; }
    if (event.target.closest('[data-game-back], [data-game-close]')) { returnToLibrary(); return; }
    if (event.target.closest('[data-player-retry]')) { const game = games.find((item) => item.id === playingId); if (game) loadGame(game); return; }
    if (event.target.closest('[data-game-fullscreen]') && !frame.hidden) frame.requestFullscreen?.().catch?.(() => ctx.toast('This game does not allow fullscreen.', 'error'));
  };
  const initializeCatalog = async (force = false) => {
    if (force) {
      memoryCache.fetchedAt = 0;
      memoryCache.games = null;
      try { localStorage.removeItem(CACHE_KEY); } catch {}
    }
    loading.hidden = false;
    error.hidden = true;
    count.textContent = 'Loading catalog…';
    try {
      const result = await loadCatalog(pageController.signal);
      if (disposed || !grid.isConnected) return;
      games = result.games;
      currentPage = 1;
      loading.hidden = true;
      main.querySelector('[data-catalog-source]').textContent = result.cached ? 'Cached catalog · source checked on refresh' : `Catalog updated · ${games.length.toLocaleString()} individual games`;
      renderLibrary();
    } catch (cause) {
      if (disposed || cause.name === 'AbortError') return;
      loading.hidden = true;
      error.hidden = false;
      count.textContent = 'Catalog unavailable';
      main.querySelector('[data-catalog-error-message]').textContent = String(cause.message || 'Try again shortly.').slice(0, 500);
    }
  };

  search.addEventListener('input', onSearch, { passive: true });
  sort.addEventListener('change', onSort);
  main.addEventListener('click', onClick);
  window.addEventListener('gooncore:game-favorites', onFavoriteEvent);
  frame.addEventListener('load', onFrameLoad);
  frame.addEventListener('error', onFrameError);
  main.__cleanup = () => {
    disposed = true;
    pageController.abort();
    playerController?.abort();
    clearTimeout(loadTimer);
    main.removeEventListener('click', onClick);
    window.removeEventListener('gooncore:game-favorites', onFavoriteEvent);
    frame.removeEventListener('load', onFrameLoad);
    frame.removeEventListener('error', onFrameError);
    frame.removeAttribute('src');
    document.documentElement.classList.remove('game-playing');
    ctx.setImmersive?.(false);
  };
  initializeCatalog();
}
