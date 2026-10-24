# JoyCon Hub

A browser gaming hub where **your phone is the controller**. Open the hub on a computer or TV, scan the QR code with your phone, and tilt to play. There's no app to install and no sign-up.

The first game is **Sky Tilt**. You fly a low-poly plane through golden rings over an endless island and steer by tilting your phone. The phone's motion sensors (accelerometer and gyroscope) supply the input.

**Play it:** https://sunilkumarsunil35.github.io/Joyconhub/ (after the one-time GitHub Pages setup below).

## Play online (GitHub Pages)

The hub is published as a plain static website. There is no server to run.

1. Open **https://sunilkumarsunil35.github.io/Joyconhub/** on a computer or TV.
2. Click **Sky Tilt** and scan the QR code with your phone camera.
3. Tap **Start**, allow motion access, hold the phone sideways and tap **Calibrate**.

GitHub Pages serves HTTPS, so phone sensors work with no certificate warnings. The phone and computer don't need to be on the same Wi-Fi, though the same Wi-Fi gives the lowest lag.

### One-time setup

1. Repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to the default branch, or run the **Deploy to GitHub Pages** workflow by hand from the Actions tab. `.github/workflows/pages.yml` builds the site and publishes it.

### How it works without a server

A static site can't host the WebSocket relay, so the GitHub Pages build (`VITE_TRANSPORT=p2p`) connects the phone and computer **directly with WebRTC**:

```
 Computer (hub)  ── WebRTC data channel (direct, encrypted) ──  Phone (controller)
        ╲                                                        ╱
         ╲─── PeerJS signalling server (only to set up the link) ╱
```

- The hub registers a PeerJS id built from the room code and a random secret. The QR code contains both, so only someone who scans it can connect.
- The free public [PeerJS](https://peerjs.com) server is used only for the initial handshake. Game traffic then goes directly between the devices. When a direct path is impossible (some mobile carriers and strict firewalls), it goes through PeerJS's free TURN relay.
- With no server checking messages in this mode, the hub and phone validate every message themselves with the same zod schemas.
- To use your own signalling server instead (`npx peerjs --port 9000`), build with `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, and `VITE_PEER_SECURE=0` for plain HTTP.

## Money Tracker (Android app)

This repository also contains **Money Tracker**, an Android app for tracking money in and out by category, by day and by month. Install it on an Android phone from https://github.com/sunilkumarsunil35/Joyconhub/releases/latest/download/MoneyTracker.apk. See [`apps/money/README.md`](apps/money/README.md) for details.

## Run it locally (relay server)

For development, or offline play on your own network, a small Node relay server is used instead:

```
 Computer / TV (hub + game)  ◀── WebSocket ──▶  Relay server  ◀── WebSocket ──▶  Phone (controller page)
        Three.js game                       rooms, tokens, validation          tilt → calibrated stick values
```

Requirements: Node 20+ and pnpm (`corepack enable` gives you pnpm).

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the relay server on port 3000 and the web app on **https://localhost:5173**.

1. Open **https://localhost:5173** on your computer. The dev certificate is self-signed, so accept the browser warning once.
2. Click **Sky Tilt**. A QR code appears. It points at your computer's **LAN address** (for example `https://192.168.1.20:5173/controller.html?r=K7QX&t=…`), not `localhost`.
3. Scan it with your phone. The phone must be on the **same Wi-Fi**. Accept the certificate warning there too (iPhone: _Show Details → visit this website_).
4. Tap **Start**, then allow motion access (iPhone asks).
5. Hold the phone sideways like a gamepad and tap **Calibrate**. The game starts on the big screen.

> **Why HTTPS?** Browsers only give motion-sensor data to secure pages, so the dev server uses HTTPS by default.

### Play from anywhere with a tunnel (no certificate warnings)

```bash
VITE_HTTP=1 PUBLIC_URL=https://<your-tunnel-host> pnpm dev
cloudflared tunnel --url http://localhost:5173      # or ngrok http 5173
```

`PUBLIC_URL` tells the hub which address to put in the QR code.

### Developer shortcuts

| URL                         | What it does                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/?transport=p2p`           | Use the GitHub Pages (WebRTC) connection on the dev server                                                                                      |
| `/?debug=1`                 | Shows an FPS / latency / input overlay, plus a **Play with keyboard** button (arrows or WASD to fly, Shift or Space to boost, Q/E for throttle) |
| `controller.html?…&sim=1`   | Controller with a drag-to-tilt touch pad instead of sensors, so you can test on a desktop browser                                               |
| Chrome DevTools → _Sensors_ | Emulates device orientation on the controller page                                                                                              |

## How to play Sky Tilt

| Phone                               | Plane                                         |
| ----------------------------------- | --------------------------------------------- |
| Tilt like a steering wheel          | Bank left/right (banking turns the plane)     |
| Lean the top edge away / toward you | Nose down / up                                |
| Throttle slider (left thumb)        | Speed                                         |
| **Boost** button (right thumb)      | Burst of speed (refills over time)            |
| ⟳ Recenter                          | Makes the current pose the new "fly straight" |
| ❚❚ Pause                            | Pauses on both screens                        |

Fly through the rings. Each ring scores `100 × combo` and adds 3 seconds to the clock. Hitting the ground or water ends the round, and so does running out of time. On the game-over screen, tap **Play again** on your phone.

Controller settings (⚙️): tilt range (sensitivity), invert pitch or roll, twist-to-steer (gyro rudder), and vibration.

## Repository layout

```
apps/
  money/         Money Tracker Android app (Capacitor + Vite): income/expense tracker
  server/        Fastify + ws relay: rooms, tokens, message validation (local dev / self-hosting)
  web/           Vite multi-page app: hub (index.html) + phone controller (controller.html)
                 src/net/: transports (WebSocket relay, PeerJS WebRTC peer-to-peer)
packages/
  protocol/      Shared message types + zod schemas (the wire contract)
  input/         Sensor math: orientation → tilt, calibration, 1€ filter, dead zone, response curve
  game-sdk/      MiniGame interface the hub uses to run any game
games/
  sky-tilt/      The plane game (Three.js): flight model, streaming terrain, ring course, HUD, audio
e2e/             Playwright tests: hub page + emulated phone, over the relay AND peer-to-peer from a
                 GitHub Pages-like static sub-folder (with a local PeerJS server)
PLAN.md          The original project plan
```

## How the tilt controls work

All of this is in `packages/input`, with unit tests.

1. **Orientation → gravity.** `deviceorientation` gives Euler angles (α, β, γ). From β and γ we compute the world-up vector in the phone's own frame. α (the compass) is ignored, so magnetic interference can't affect steering.
2. **Device → screen frame.** The vector is rotated by `screen.orientation.angle`, so "right" and "up" always mean what the player sees, in any landscape or portrait orientation.
3. **Tilt angles.** Roll is how far the screen's right edge drops below horizontal. Recline is how far the screen leans back from vertical. Both are exact for rotations about the world-horizontal axes, which is how a plane banks and pitches, whatever pose the phone is held in.
4. **Calibration.** The pose at the moment you tap Calibrate becomes neutral. If a browser reports the opposite landscape angle, calibration detects it from gravity and corrects it.
5. **Shaping.** A 1€ filter (smooth when still, responsive when moving) is followed by a ±3° dead zone, a response curve (finer control near the center), and normalisation to −1…1.
6. **Transport.** Processed values are sent at up to 60 Hz, only when they change, plus a 10 Hz heartbeat. The hub always uses the latest sample and re-centres the stick if no input arrives for 500 ms.

The game maps the stick to a **target attitude**. Holding the phone at its calibrated pose always means "fly level".

## Pairing & connection rules

- Each room has a 4-character code (no 0/O/1/I/L) plus a secret controller token carried in the QR code. Guessing a room code alone isn't enough to join.
- Relay mode: the server validates every message with zod and only relays what each role may send. Messages larger than 1 KB, or more than 120 per second, are dropped. Peer-to-peer mode: each side validates incoming messages itself.
- If the phone locks or drops off Wi-Fi, the game pauses and the QR code comes back. The phone reconnects by itself when unlocked and the game resumes.
- Relay rooms expire 2 minutes after both sides leave, or after 30 minutes if no controller ever joins. A peer-to-peer room lasts as long as the hub tab is open.

## Adding a new game

1. Create `games/<name>` with a `createGame()` that returns a `MiniGame` (`mount`, `update(dt)`, `restart`, `pause`, `resume`, `unmount`). Read input from `ctx.input()` and report events with `ctx.emit()`.
2. Export metadata: title, card accent, and the controller layout (which buttons to show, and whether to show the throttle).
3. Add one entry in `apps/web/src/hub/registry.ts`.

The hub already handles pairing, pausing, reconnects and haptics.

## Scripts

| Command                                        |                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`                                     | Relay server + HTTPS Vite dev server                                           |
| `pnpm build`                                   | Production build of the web app (`apps/web/dist`)                              |
| `pnpm start`                                   | Production server: serves the build + WebSocket relay on `PORT` (default 3000) |
| `pnpm test`                                    | Unit and integration tests (Vitest)                                            |
| `pnpm e2e`                                     | End-to-end tests (Playwright; builds and starts all servers itself)            |
| `pnpm typecheck` / `pnpm lint` / `pnpm format` |                                                                                |

## Deploying

**GitHub Pages** (recommended, free, no server): see [Play online](#play-online-github-pages) above.

**Self-hosting the relay server (optional).** The production server is one Node process that serves the built app and the `/ws` relay. Deploy it anywhere that supports WebSockets and terminates HTTPS:

```bash
docker build -t joyconhub .
docker run -p 8080:8080 joyconhub
```

| Env var               | Purpose                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `HOST`        | Listen address (production default `0.0.0.0:3000`; the Docker image uses 8080)                                                    |
| `PUBLIC_URL`          | Base URL for QR codes. Needed behind proxies/tunnels if the hub is opened via a different host                                    |
| `TLS_CERT`, `TLS_KEY` | Serve HTTPS directly (e.g. with [mkcert](https://github.com/FiloSottile/mkcert) certificates for LAN play without the dev server) |
| `ALLOWED_ORIGINS`     | Comma-separated origins allowed to create rooms and open sockets                                                                  |

## Browser support

- **Controller:** iOS Safari 13+ (asks for motion permission), Android Chrome. Phones without motion sensors get touch controls. iPhones have no vibration API, so they get a screen flash instead.
- **Hub:** current Chrome, Edge, Firefox or Safari with WebGL.

## Troubleshooting

| Problem                                                                         | Fix                                                                                                                               |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Phone can't open the QR link                                                    | Local dev: phone and computer must share a network (or use a tunnel). Some guest/corporate Wi-Fi blocks device-to-device traffic. |
| GitHub Pages: stuck on "Setting up connection…" or the phone keeps reconnecting | A firewall/VPN may block WebRTC or the PeerJS server. Try another network (e.g. phone on mobile data) or turn off the VPN.        |
| "No motion sensors" on the phone                                                | The page must be HTTPS. Use GitHub Pages, `pnpm dev`, a tunnel, or `TLS_CERT`/`TLS_KEY`.                                          |
| iPhone never asked for motion access                                            | Settings → Safari → _Motion & Orientation Access_, then reload.                                                                   |
| The plane drifts                                                                | Tap ⟳ Recenter while holding your natural pose; lower sensitivity in ⚙️.                                                          |
| Screen doesn't rotate to landscape                                              | Turn off rotation lock, or tap "Play in portrait".                                                                                |
