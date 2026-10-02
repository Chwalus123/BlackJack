# Jacbos Casino

Casino-style **Blackjack** and **Texas Hold'em** in the browser, with a procedurally generated **3D AI dealer** who deals every card with animation.

- **Single-player:** you plus up to four AI players. You set a fictitious stake.
- **Multiplayer:** real players join in real time. The table host sets one fixed stake for everyone.
- **One big table:** Blackjack seats are unlimited, and everyone acts at once on their own clock. Hold'em seats up to 22 players (one deck), and anyone beyond that waits in a spectator queue.
- **Casino rules:** Blackjack pays 3:2, insurance pays 2:1, even money, peek, double, split, and the dealer stands on soft 17. Hold'em is No-Limit with small and big blinds, side pots and TDA showdown rules.
- **Polish by default**, with an English toggle.
- **Fictitious chips only:** no real money, purchases or prizes.

> Gra wyłącznie dla zabawy. Żetony nie mają wartości pieniężnej. / For entertainment only. Chips have no monetary value.

---

## Run it locally

**Prerequisites:** Node.js **22** or newer (see `.nvmrc`) and npm 10. A browser with WebGL.

```bash
git clone <this repo> && cd BlackJack
npm ci            # installs every workspace
npm run dev       # server on :3000 + client on :5173 (hot reload)
```

Open **http://localhost:5173**.

- **Single-player** runs entirely in the browser, so `npm run dev:client` alone is enough.
- **Multiplayer** needs the server, which `npm run dev` starts for you. The Vite dev server proxies `/socket.io` and `/healthz` to it.

### Try multiplayer on one machine

1. Run `npm run dev` and open http://localhost:5173 in two browser windows. Use a private window for the second one, so each window gets its own guest identity.
2. In window A: **Blackjack → Multiplayer → Open a table**, choose a stake, then **Take a seat → Start the game**.
3. Copy the invite link (or the 6-character code) into window B, then **Take a seat**.
4. To include phones on your LAN, run `npm run dev` and open `http://<your-computer-ip>:5173`. The dev server listens on all interfaces.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server (tsx watch) and client (Vite) together |
| `npm run dev:client` / `npm run dev:server` | Only one of them |
| `npm test` | All unit, property and integration tests (Vitest) |
| `npm run test:slow` | Long suites: the full 133,784,560-hand Hold'em evaluator sweep and a blackjack house-edge simulation |
| `npm run test:e2e` | Browser end-to-end tests (Playwright; builds and starts the app) |
| `npm run typecheck` | Strict TypeScript across every workspace |
| `npm run lint` | ESLint (the engine forbids clocks, `Math.random` and host APIs) |
| `npm run build` | Production build: `apps/client/dist` + bundled `apps/server/dist` |
| `npm start` | Serves the built client and the multiplayer server on http://localhost:3000 |
| `npm run load -- --bots 300` | Load smoke test: N socket bots at one table |

In environments where Playwright's Chromium is preinstalled, set `PLAYWRIGHT_BROWSERS_PATH` before `npm run test:e2e`.

---

## Production build and Docker

```bash
npm run build && npm start                       # http://localhost:3000, healthcheck at /healthz
docker compose -f compose.local.yml up --build   # same thing in the production container
```

## Deploying to a VPS

The bundled `docker-compose.yml` runs the game behind **Caddy**, which gets HTTPS certificates automatically and proxies WebSockets.

1. Point your domain's DNS **A/AAAA** record at the VPS. Open ports 80 and 443.
2. Install Docker with the Compose plugin on the VPS, then copy or clone this repository there.
3. Configure and start:
   ```bash
   cp .env.example .env        # set DOMAIN=casino.example.com (and optionally ACME_EMAIL)
   docker compose up -d --build
   ```
4. Check it: `curl https://casino.example.com/healthz` should return `{"ok":true,…}`.

**Updating:**
- Run `git pull && docker compose up -d --build`.
- On shutdown the server tells players, lets running hands finish (up to 20 s), then refunds anything left unsettled.

**Logs:** `docker compose logs -f casino`.

**Without Docker:**
- Run `npm ci && npm run build`, then run `node apps/server/dist/index.js` under systemd or pm2, with `NODE_ENV=production`, `PUBLIC_ORIGIN=https://your.domain` and `TRUST_PROXY=1`.
- Proxy it with nginx. WebSocket upgrades need `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`.
- Run exactly **one** Node process. Rooms live in memory.

### Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `PUBLIC_ORIGIN` | – | Allowed browser origin (e.g. `https://casino.example.com`); same-origin is always allowed |
| `TRUST_PROXY` | `0` | `1` when behind Caddy/nginx (uses `X-Forwarded-For` for per-IP limits) |
| `STATIC_DIR` | `apps/client/dist` | Built client to serve |
| `MAX_ROOMS` | `200` | Open tables at once |
| `MAX_PLAYERS_PER_ROOM` | `0` | Blackjack seat cap; `0` = unlimited |
| `MAX_SPECTATORS_PER_ROOM` | `500` | Spectators per table |
| `MAX_CONNECTIONS` / `CONNECTIONS_PER_IP` | `3000` / `12` | Connection guards |
| `RECONNECT_GRACE_MS` | `60000` | A dropped player keeps their seat this long |
| `LOG_LEVEL` | `info` | `silent`…`trace` |

---

## How it works

```
packages/engine     Pure TypeScript rules engine (no DOM, no Node APIs). Blackjack + Hold'em state
                    machines, ChaCha20 RNG, Fisher-Yates shoe, integer chip ledger, AI players,
                    and TableHost — the runtime used both in the browser and on the server.
packages/protocol   Typed Socket.IO events, zod validation, room settings.
apps/server         Fastify + Socket.IO: rooms, host powers, sessions/reconnect, redaction, static client.
apps/client         Vite + Preact HUD over a Three.js scene: procedural table, cards, chips and dealer.
```

- **One engine, two hosts.**
  - Single-player runs the engine in the browser with bots, so it works offline and with static hosting.
  - Multiplayer runs the same engine on the server, which is authoritative.
  - Clients only ever send intents. The server adds the seat, the time and the stake.
- **Hidden information:**
  - Hole cards are sent only to their owner.
  - The deck, the shoe and the RNG state are never sent to anyone.
  - Card ids carry no information about the card.
- **Animation:**
  - Every engine event (card dealt, card flipped, chips moved…) is choreographed by an animation director: the dealer's arm, card flights, flips and chip movements.
  - Totals and results appear only when the animation shows them.
  - Speed is adjustable (0.5×–instant) and respects *reduced motion*.
- **Original assets:**
  - The cards, chips, felt print, table, dealer model and rules text are all generated or written for this project.
  - The only third-party assets are two OFL fonts (Cinzel, Montserrat) and MIT-licensed libraries; see `THIRD_PARTY_NOTICES`.

## Rules in brief

- **Blackjack:**
  - 6-deck shoe with the cut card at 70–80%.
  - The dealer stands on all 17s and peeks on an ace or ten.
  - Blackjack pays 3:2, insurance pays 2:1, even money is offered.
  - You may double on any two cards, including after a split. You may split to 4 hands; split aces get one card each.
  - In multiplayer everyone decides at the same time. A timeout stands your hand.
- **Texas Hold'em (No-Limit):**
  - Small and big blinds (BB = 2 × SB) with a moving button, including heads-up rules.
  - Minimum raises follow the TDA rules; an incomplete all-in does not reopen the betting.
  - Side pots, split pots with the odd chip, and the standard showdown order.
  - In multiplayer the host fixes the blinds and the buy-in. Up to 22 seats, then a spectator queue.

The full rules are in the game under **Zasady / Rules**, in Polish and English.

---

## Legacy v0 review (what was here before)

The original version was a single static Polish page (`witalnia.html`, `blackjack.html`, `blackjack.js`, `zasadygry.html`). It was not playable as real blackjack.

| Where | Problem |
|---|---|
| `blackjack.js` `getValue`/`checkAce` | Aces always counted 11. The ace counters were tracked but never used, so A+A = 22 was a bust. |
| `blackjack.js` `startGame` | The dealer drew his whole hand on page load, before the player acted. |
| `blackjack.js` `hit` | No bust check: you could keep hitting past 21. |
| `blackjack.js` `stay` | Totals appeared only at "Stop". No natural blackjack / 3:2, no betting, double, split or insurance. |
| `blackjack.js` `shuffleDeck` | Biased shuffle (swap with a random index over the whole array). The test suite shows it failing a χ² test that Fisher-Yates passes. |
| `blackjack.js` | `console.log` printed the whole deck and both totals (a cheat leak). One 52-card deck was never reshuffled, and a new round needed a page reload. |
| HTML/CSS | No `index.html`, so a server root would 404. Invalid markup in the rules page, fixed pixel sizes, not responsive. An unused Font Awesome kit was loaded. |
| Assets | The card images and the rules text (copied from interplay.pl) were not original. |

Everything was rewritten. The old files are kept in git history. Regression tests for each of these bugs live in `packages/engine/test/blackjack.test.ts`.

## License

Private project by its owner. Third-party components keep their own licenses (`THIRD_PARTY_NOTICES`).
