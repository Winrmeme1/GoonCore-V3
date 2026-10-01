# GoonCore

A self-hosted, no-account home for private DuckDuckGo search, public-site browsing, original browser games, and legal movie discovery.

## Start it up

**Needs Node.js 20 or later. No package manager, install step, third-party runtime dependencies, tracking pixels, fonts, or build process required.** From this directory:

```sh
node --version
npm start
```

Open **http://127.0.0.1:4173**. Development mode uses Node's built-in watch flag:

```sh
npm run dev
```

Built-in tests:

```sh
npm test
```

Choose a different port or address using `PORT` / `HOST` environment variables, e.g. `PORT=8080 npm start`. The server binds to loopback (`127.0.0.1`) unless explicitly configured otherwise.

## Putting it online (Cloudflare Tunnel)

GoonCore is a Node process, not a static site. `/api/search`, `/api/games`, `/api/embed-check`, `/api/health` and the `/api/proxy` relay are all answered by `server.mjs`. Uploading `public/` to a static host — Cloudflare Pages, GitHub Pages, S3 — therefore breaks Web, Games **and** Movies at once: those paths return an HTML page instead of JSON, and the client fails with `Failed to execute 'json' on 'Response': Unexpected end of JSON input` on all three routes. Keep the Node server running and publish it through a tunnel instead; no application code needs to change.

Install `cloudflared`, then run the app and the tunnel side by side:

```sh
npm start
cloudflared tunnel --url http://127.0.0.1:4173
```

`cloudflared` prints a random `https://….trycloudflare.com` address. Quick tunnels need no account, but the address changes on every restart and anyone holding the link can reach the machine, the relay included. That last part matters: relayed traffic leaves from your own network address, and Cloudflare's terms restrict running a general-purpose web proxy over their network — so treat a quick tunnel as short-lived personal access, not a public service.

For a stable hostname behind a login, create a **named tunnel** on a domain in your Cloudflare account and put **Cloudflare Access** in front of it (an email one-time-PIN policy is free). GoonCore has no accounts by design, so Access is what stops a tunneled install from becoming an open proxy.

Every tunneled request arrives from the tunnel's own loopback address, which would otherwise funnel all visitors into a single rate-limit bucket. Point the server at the origin-IP header the proxy injects:

```sh
TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip npm start
```

Set that only while the process is unreachable except through the proxy: a caller who can reach GoonCore directly could otherwise rotate the header to reset its own limit. The header is accepted only when it parses as an IP address — anything else falls back to the socket address.

## Movies and games

Movies is a dedicated responsive player that stays inside GoonCore. It ships with `https://zxcstream.icu/` as its default provider; paste a different **official HTTPS embed URL** in Settings to override it. The player loads only when you open Movies and choose Load, and the server checks DNS plus the provider's current framing headers first. GoonCore honors the provider's X-Frame-Options and Content-Security-Policy: if framing is refused, the in-app player shows an error—there is no new-tab fallback, hosting, downloading, or movie proxying. The provider frame is a plain cross-origin embed with no `sandbox` attribute, because the widely used players detect a sandboxed frame (they probe `document.domain`) and refuse to play; the browser's own same-origin policy still keeps the provider out of GoonCore's DOM, storage and cookies.

Games fetches the machine-readable `zones.json` manifest from GN Math’s public `assets` repository when the Games route is opened. The manifest supplies IDs, titles, cover templates, and individual HTML paths; GoonCore adapts these into allowlisted URLs served by GitHub’s own infrastructure — individual games from the org’s Pages site (`gn-math.github.io/html`) and cover artwork from raw GitHub content — because jsDelivr blocks the entire `gn-math` user with HTTP 403. Metadata is cached for six hours in the server process and browser storage. Covers lazy-load in a compact responsive grid; choosing a title permission-checks that individual HTML game and then loads it directly in the sandboxed player—no separate authorization prompt stands in the way. The app never embeds the GN Math website. X-Frame-Options and CSP are checked and honored, so unsupported titles show an in-app error rather than bypassing controls.

## Search and the Web browser

Search runs through the local relay, so a query is never handed to the browser as a navigation. **DuckDuckGo** is the default engine; a **Search engine** dropdown in Settings (next to Region) also offers Google, Bing and Brave. Engines differ in how well they survive a relay: DuckDuckGo and Bing return server-rendered result pages, while Google and Brave expect JavaScript and often answer the relay with their own limited or blocked page — the in-app error reports what the destination actually returned. Region and safe-search preferences are translated into each engine's own parameter names before the destination is built.

The Web browser fills the window. The relayed frame's height tracks the viewport instead of a fixed cap, so the panel cannot leave a dead band below itself on a tall screen. The ⛶ control in the browser toolbar is an in-app full-screen overlay (the button or `Escape` leaves it) rather than the HTML Fullscreen API, which some hosts deny or leave pending forever; `:fullscreen` is styled as well for hosts that do enter native full screen.

## Application map

```text
.
├── server.mjs            Zero-dependency Node backend, SSRF-safe proxy and provider policy checks
├── package.json          npm start / npm run dev / npm test
├── public/
│   ├── index.html        Accessible app shell and navigation
│   ├── styles.css        Responsive centered GoonCore design system, themes, and reduced-motion styles
│   ├── app.js            Lightweight route shell, canvas, local preferences
│   ├── web.js            In-app HTTP(S) proxy browser, full screen mode and same-origin search routing
│   ├── games.js          Cached native GN Math catalog and isolated per-game player
│   ├── movies.js         Lazy built-in-provider movie room (zxcstream.icu by default)
│   └── settings.js       Persistent appearance, search and privacy controls
└── test/
    ├── server.test.mjs   Security validation and endpoint smoke tests
    └── proxy.test.mjs    Search, URL rewrite and provider policy regression checks
```

Navigation is lazy-loaded native JavaScript modules. Game catalog metadata is cached; covers load on demand; games are paginated in the UI and only one individual game can be loaded at a time. Favorites, recently played games, shortcuts, history and visual preferences stay in browser `localStorage`. Background animation is paused while a game is active, while hidden, or when reduced/performance settings require it.

## Proxy security and practical limits

The proxy is a server-side **convenience relay**, not a VPN, a DRM bypass, or a fully faithful modern browser. The web client uses only same-origin fetch. The local Node backend:

- allows standard-port HTTP(S) only; rejects URLs with credentials, dangerous schemes, private/link-local IPs, internal-only DNS names, and DNS results that include private addresses;
- pins the resolved public IP address to the outbound HTTP(S) connection, protecting against DNS-rebinding/SSRF attacks;
- revalidates every redirect and keeps following only through the same proxy;
- rate-limits requests in separate API (90/minute) and relay (900/minute) buckets per client, applies four-second DNS and ten-second per-request plus fifteen-second overall proxy timeouts, disables upstream compression, and enforces an actual one-megabyte response-body cap;
- carries the requesting browser's own user-agent (with a standard desktop fallback) so that sites which answer generic crawler-style agents with bot challenges still return the page the user asked for;
- decodes HTML entities inside `src`/`href`/`srcset`/meta-refresh attributes before resolving them, so links whose query strings contain `&amp;` keep working, and follows pure client-side redirect stubs (a tiny page whose only action is `location.replace(...)`) as a real relay hop instead of leaving the frame blank;
- bounds memory on the app's larger static assets using streams; caps process-local rate-limit state; and serves restrictive app and sandbox headers;
- serves safe, common web assets and rejects unsupported file types. Proxied HTML runs in an opaque browser sandbox with scripts/forms but without shared cookies, permissions, top navigation, parent-page storage or access to GoonCore. Relative links, images and CSS assets are rewritten through the SSRF-protected relay; nested iframes retain restrictive sandboxing and unsafe navigation grants are stripped. Because a relayed page is re-served from GoonCore's own origin, its policy is translated instead of replayed: upstream CSP source lists keep their restrictions and gain `'self'` so the rewritten same-origin assets load, while a `frame-ancestors`/X-Frame-Options rule that would forbid GoonCore from displaying the relay is re-scoped to `'self'` (the document still runs in an opaque sandbox). Direct cross-origin embeds used by Movies and Games keep the full upstream frame-policy check. In-document navigation and redirects are relayed in the existing Web tab; unsupported/security-blocked responses display an in-app error.

Websites can still refuse the connection, block embedding, require sign-in/cookies/POST forms, depend on service workers/WebSockets, cross-origin requests, streaming, DRM or JavaScript that makes its own third-party absolute requests. These limitations cannot be safely solved by client code or by blindly relaying arbitrary requests, so unsupported flows show an in-app error. Movies and games do not provide a navigation fallback that leaves GoonCore. The 1 MB cap and standard-port policy intentionally favor safety and bounded memory over compatibility.

The service starts bound to **localhost**, making the proxy accessible only to its own device. Do **not** expose it on the public internet directly; if you tunnel it, put an authentication layer such as Cloudflare Access in front first (see **Putting it online** above). For a shared installation, keep authentication, TLS, host allowlists, network egress filtering and abuse controls ahead of it; localhost binding, a process-local rate limit, and SSRF filtering are not substitutes for a managed public proxy service. There is intentionally no user account: this is a single-device app whose data lives in local browser storage.
