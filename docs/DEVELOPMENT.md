# Development

Back to the [README](../README.md). For the architecture and the scoring internals, see [DESIGN.md](DESIGN.md).

## Requirements

**Node 22.12 or newer.**

## Running from source

These steps were written for Linux. They should largely apply for Windows as well:

```bash
git clone https://github.com/papelblume/CS2Clean.git
cd CS2Clean
npm ci
npm start
```

On Linux, `npm run build` also compiles the optional Wayland `wlr-layer-shell` overlay helper (`tools/wayland/wayland-overlay.c`) if `wayland-scanner` and `wayland-client` development headers are installed.

## Run modes

`npm start` builds and runs the app against the real game (Steam's players list and CS2's game-state feed). The other modes are for development without CS2 or Steam data:

```bash
npm run start:replay                       # plays fixtures/premier-mirage.jsonl instead of a live match
npm start -- --replay=path/to/file.jsonl   # plays a recording of your own
npm run start:overwolf                     # Overwolf's CS2 events and overlay (needs Overwolf's approval for the app)
npm run start:overwolf -- --record         # ...and saves what Overwolf reports to recordings/ in the app's data folder
```

## The csst.at fallback

The fallback fetches player stats directly from `csst.at` in-process (`src/main/leetify-hero.ts` + `src/main/csst-parse.ts`) using Electron's `net.fetch` (Chromium's TLS/HTTP2 stack). No external browser download or sidecar is required.

If the window says "csst.at fallback unavailable", `csst.at` was unreachable, timed out, or returned a Cloudflare challenge (HTTP 403).

## Linux: chrome-sandbox error

If Electron refuses to start with a `chrome-sandbox` error (common on Ubuntu 24.04 and derivatives), grant the sandbox the permissions it needs:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

From the Linux tar.gz release, the file sits in the extracted folder instead:

```bash
sudo chown root:root cs2clean-*/chrome-sandbox
sudo chmod 4755 cs2clean-*/chrome-sandbox
```

## Environment variables

| Variable | What it does |
|----------|--------------|
| `LEETIFY_API_KEY` | Your Leetify API key. A key saved in the app takes priority |
| `STEAM_API_KEY` | Your Steam Web API key. A key saved in the app takes priority |
| `CSREP_API_KEY` | Your CSRep.GG API key (`X-API-Key`). A key saved in the app takes priority |
| `CS2CLEAN_CSST_ORIGIN` | The address the fallback reads csst.at from (default `https://csst.at`), for testing |

## UI development

Preview UI states in a browser without running the full app:

```bash
npm run dev:ui
```

Then open `http://localhost:5173` with query params:
- `?screen=lobby|detail|player|nokey|waiting|community|problem|hint` — which screen to show (default: lobby)
- `?fallback=off` — preview the window with the csst.at fallback unavailable

## Debug scripts

```bash
npm run leetify:probe    # test the Leetify API client directly
npm run coplay           # run the Steam coplay reader standalone
npm run friends-ui       # show what the app can use to find friends (debug port, console.log, profile fallback), the friends list status lines and who would be added
npm run console-status   # watch CS2's console.log (-condebug): run `status` in CS2 to see which lobby names are your friends (STEAM_API_KEY adds all your friends' names)
```

## Checks

```bash
npm test
npm run typecheck
npm run build
npm run check:package                                # verify a packaged app's asar contains expected files
```
