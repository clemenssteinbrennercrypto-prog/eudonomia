# Eudonomia (native macOS app)

A native macOS app (Tauri) that hosts the [Eudonomia](https://eudaimonia-psi.vercel.app)
focus tracker in its own window and enforces distraction blocking on the whole
machine. Running the UI in-app avoids every browser↔localhost problem (Brave
shields, IPv6, mixed content).

## What it does

- **Hosts the UI** in its own window from a **locally bundled** copy of the web
  app (`companion/webui`) — no browser, no extension. Loading the UI from the
  app's own local origin is what makes the in-app WebView able to reach the
  local companion server; a remote (https) origin is blocked from talking to
  localhost. A menubar tray gives quick open/quit.
- **Detects the frontmost app + browser tab URL** every 3 seconds via AppleScript
  (Safari, Chrome, Arc, Brave) and serves it on `http://127.0.0.1:7331/status`.
- **Blocks distractions during a session:**
  - Websites → `/etc/hosts`, system-wide across **all** browsers. A one-time
    privileged helper (installed with a single admin prompt) lets this run
    silently thereafter — see `helper/eudonomia-hosts`.
  - Apps → hidden while frontmost. Strict mode hides every non-browser app
    except the allowed ones + base system apps.
  - A triple failsafe (startup, session-end/expiry watchdog, quit) guarantees a
    block never outlives its session.

## Updates

The app **updates itself**. On launch it checks GitHub Releases for a newer
signed build and installs it in the background (applies next launch). So neither
the user nor a co-developer ever re-installs by hand — see
`.github/workflows/companion-release.yml`, which builds, signs, and publishes a
release on every `companion/**` change (CI assigns the version automatically, no
manual bumping).

Because the UI is bundled (`companion/webui`), a web-app change reaches the
native app only when that bundle is refreshed and a new companion release is
built. The workflow that keeps `companion/webui` in sync with the web app is the
next thing to wire up; until then, rebuild it with
`npm run build && rm -rf companion/webui && cp -r dist companion/webui`.

## Build

```bash
cd companion/src-tauri
cargo tauri build      # → target/release/bundle/dmg/*.dmg
cargo test             # pure blocking/scoring logic
```

## How it connects

The in-app WebView talks to the companion's local server on
`http://127.0.0.1:7331` (CORS + Private-Network headers, bound on IPv4 and IPv6).
Response shape:

```json
{ "app": "Safari", "window": "YouTube", "url": "https://www.youtube.com/…",
  "domain": "youtube.com", "ts": 1720000000000 }
```
