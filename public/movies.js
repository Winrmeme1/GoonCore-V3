const DEFAULT_MOVIE_PROVIDER = 'https://zxcstream.icu/';

function providerUrl(ctx) {
  return String(ctx?.settings?.movieEmbedUrl || '').trim() || DEFAULT_MOVIE_PROVIDER;
}
function providerHost(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return 'the provider'; }
}

function authorizedUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) throw new Error('Add an authorized HTTPS embed URL in Settings first.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Enter a complete HTTPS provider embed URL in Settings.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const blockedHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example') || host === 'metadata.google.internal';
  const ipv4 = host.split('.').map(Number);
  const privateIpv4 = ipv4.length === 4 && (ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] === 0
    || ipv4[0] === 192 && ipv4[1] === 168 || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31
    || ipv4[0] === 169 && ipv4[1] === 254 || ipv4[0] >= 224);
  const privateIpv6 = host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || /^fe[89ab]/.test(host)
    || host.startsWith('::ffff:') && (host.endsWith('127.0.0.1') || host.includes(':a00:') || host.includes(':ac1:'));
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || blockedHost || privateIpv4 || privateIpv6) {
    throw new Error('The movie provider must be a public HTTPS URL without credentials or private hosts.');
  }
  return url.href;
}

export function mount(ctx) {
  const provider = providerUrl(ctx);
  const host = ctx.esc(providerHost(provider));
  return `<header class="page-intro"><div><p class="eyebrow"><span class="privacy-indicator"></span>YOUR PROVIDER</p><h1>Movies</h1><p>One spacious player, inside GoonCore. Streaming is delivered by ${host} without leaving the app.</p></div></header>
    <section class="movie-room" aria-label="Movie player">
      <header class="movie-room-header"><div><p class="eyebrow">PRIVATE VIEWING ROOM</p><h2 data-movie-title>Ready when you are</h2><span class="section-note" data-movie-host>Provider ready · ${host}</span></div><div class="movie-room-actions"><button type="button" class="icon-button" data-movie-fullscreen aria-label="Full screen player" title="Full screen" disabled>⛶</button><button type="button" class="icon-button" data-movie-stop aria-label="Stop player" title="Stop player" disabled>×</button></div></header>
      <div class="movie-screen" data-movie-screen>
        <div class="movie-screen-state" data-movie-idle><span class="proxy-empty-icon" aria-hidden="true">${ctx.icon('movies')}</span><strong>Your player is ready</strong><p>${host} connects only when you choose to load it. Change the URL in Settings any time.</p><button type="button" class="primary-button" data-movie-load>Load provider</button></div>
        <div class="movie-screen-state" data-movie-loading role="status" hidden><span class="spinner" aria-hidden="true"></span><strong>Checking provider permissions…</strong><p>Its own framing and browser security policies stay in force.</p></div>
        <div class="movie-screen-state" data-movie-error role="alert" hidden><span class="proxy-empty-icon" aria-hidden="true">${ctx.icon('shield')}</span><strong data-movie-error-title>Provider unavailable</strong><p data-movie-error-message>The provider may be offline or may not permit embedding. GoonCore will not open another tab or bypass its controls.</p><button type="button" class="secondary-button" data-movie-retry>Try again</button></div>
        <iframe class="movie-screen-frame" data-movie-frame title="Movie provider" referrerpolicy="no-referrer" loading="lazy" allow="fullscreen; picture-in-picture; autoplay; encrypted-media" hidden></iframe>
      </div>
      <footer class="movie-room-footer"><span data-movie-status>Not connected · choose Load to begin</span><button type="button" class="primary-button" data-movie-footer-load>Load provider</button></footer>
    </section>
    <aside class="movie-policy-note"><span class="privacy-indicator" aria-hidden="true"></span><span><strong>One tap away.</strong> GoonCore loads the provider shown above (default ${host}, editable in Settings) as a plain cross-origin frame, because many players refuse to run inside a browser sandbox. Its X-Frame-Options, Content-Security-Policy, authentication, and playback rules are respected, and the provider cannot read anything in GoonCore; GoonCore never hosts, downloads, or redistributes movies.</span></aside>`;
}

export function activate(ctx, main) {
  const frame = main.querySelector('[data-movie-frame]');
  const idle = main.querySelector('[data-movie-idle]');
  const loading = main.querySelector('[data-movie-loading]');
  const error = main.querySelector('[data-movie-error]');
  const status = main.querySelector('[data-movie-status]');
  const title = main.querySelector('[data-movie-title]');
  const host = main.querySelector('[data-movie-host]');
  const fullscreen = main.querySelector('[data-movie-fullscreen]');
  const stop = main.querySelector('[data-movie-stop]');
  let request;
  let loadTimer;
  let disposed = false;

  const setError = (message) => {
    if (disposed || request?.signal.aborted) return;
    clearTimeout(loadTimer);
    request?.abort();
    frame.removeAttribute('src');
    frame.hidden = true;
    fullscreen.disabled = true;
    loading.hidden = true;
    error.hidden = false;
    main.querySelector('[data-movie-error-title]').textContent = 'Provider cannot be embedded';
    main.querySelector('[data-movie-error-message]').textContent = String(message || 'The provider refused framing or is unavailable.').slice(0, 700);
    status.textContent = 'Provider unavailable';
    fullscreen.disabled = true;
    stop.disabled = false;
    ctx.setImmersive?.(false);
  };
  const load = async () => {
    request?.abort();
    request = new AbortController();
    clearTimeout(loadTimer);
    fullscreen.disabled = true;
    frame.removeAttribute('src');
    frame.hidden = true;
    error.hidden = true;
    idle.hidden = true;
    loading.hidden = false;
    fullscreen.disabled = true;
    stop.disabled = false;
    title.textContent = 'Checking authorized provider';
    host.textContent = 'Contacting the local permission check…';
    status.textContent = 'Checking provider permissions…';
    try {
      const configuredUrl = authorizedUrl(providerUrl(ctx));
      const response = await fetch(`/api/embed-check?url=${encodeURIComponent(configuredUrl)}`, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]),
        cache: 'no-store', headers: { Accept: 'application/json' },
      });
      const result = await response.json();
      if (!response.ok || !result.embeddable) throw new Error(result.error || 'The provider does not allow embedding this page.');
      if (disposed || request.signal.aborted || !frame.isConnected) return;
      const approvedUrl = authorizedUrl(result.url || configuredUrl);
      if (approvedUrl !== configuredUrl) throw new Error('The provider redirected to a different URL. Save its final, official embed URL in Settings before loading it.');
      if (!frame.isConnected || request.signal.aborted) return;
      frame.src = configuredUrl;
      frame.hidden = false;
      loading.hidden = true;
      title.textContent = 'Now playing';
      host.textContent = new URL(configuredUrl).hostname;
      status.textContent = 'Connecting to authorized provider…';
      ctx.setImmersive?.(true);
      loadTimer = setTimeout(() => {
        if (disposed || request.signal.aborted || !frame.isConnected) return;
        setError('The provider did not finish loading. It may block embedded playback or require a browser feature GoonCore does not enable.');
      }, 20_000);
    } catch (cause) {
      if (cause.name === 'AbortError' || disposed || request.signal.aborted) return;
      setError(cause.message);
    }
  };
  const stopPlayback = () => {
    request?.abort();
    clearTimeout(loadTimer);
    fullscreen.disabled = true;
    frame.removeAttribute('src');
    frame.hidden = true;
    loading.hidden = true;
    error.hidden = true;
    idle.hidden = false;
    fullscreen.disabled = true;
    stop.disabled = true;
    title.textContent = 'Ready when you are';
    host.textContent = `Provider ready · ${providerHost(providerUrl(ctx))}`;
    status.textContent = 'Stopped · choose Load to begin';
    ctx.setImmersive?.(false);
  };
  const onFrameLoad = () => {
    if (frame.hidden || disposed || !request || request.signal.aborted) return;
    clearTimeout(loadTimer);
    fullscreen.disabled = false;
    status.textContent = 'Provider connected · playback controlled by source';
  };
  const onFrameError = () => {
    if (request?.signal.aborted || frame.hidden || disposed) return;
    setError('The browser or provider refused the embedded page. The provider’s security policy has not been changed.');
  };
  const onClick = (event) => {
    if (event.target.closest('[data-movie-load], [data-movie-footer-load]')) load();
    else if (event.target.closest('[data-movie-retry]')) load();
    else if (event.target.closest('[data-movie-stop]')) stopPlayback();
    else if (event.target.closest('[data-movie-fullscreen]') && !frame.hidden) {
      (main.querySelector('[data-movie-screen]') || frame).requestFullscreen?.().catch?.(() => ctx.toast('The provider does not allow fullscreen playback.', 'error'));
    }
  };
  frame.addEventListener('load', onFrameLoad);
  frame.addEventListener('error', onFrameError);
  main.addEventListener('click', onClick);
  main.__cleanup = () => {
    disposed = true;
    request?.abort();
    clearTimeout(loadTimer);
    fullscreen.disabled = true;
    frame.removeEventListener('load', onFrameLoad);
    frame.removeEventListener('error', onFrameError);
    main.removeEventListener('click', onClick);
    frame.removeAttribute('src');
    ctx.setImmersive?.(false);
  };
}
