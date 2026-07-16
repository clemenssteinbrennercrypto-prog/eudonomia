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

The app checks GitHub Releases for a newer signed native build through Tauri's
updater. The in-app refresh control always offers a local reload, and shows a
separate install action only when the updater reports a real native app update.
See `.github/workflows/companion-release.yml`, which builds a universal macOS
DMG, signs it with a Developer ID Application certificate, notarizes it, staples
the notarization ticket, verifies Gatekeeper acceptance, and only then publishes
the GitHub Release. CI assigns the version automatically, no manual bumping.

The user-facing download is the `.dmg` asset from the latest Companion release.
The `.app.tar.gz`, `.sig`, and `latest.json` assets are updater inputs and
should not be presented as manual-install downloads.

Release publishing requires these GitHub Actions secrets:

- `APPLE_CERTIFICATE` — base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD` — password for that `.p12`
- `APPLE_SIGNING_IDENTITY` — `Developer ID Application: ... (TEAMID)`
- `APPLE_ID` — Apple Developer account email for notarization
- `APPLE_PASSWORD` — app-specific password for `APPLE_ID`
- `APPLE_TEAM_ID` — 10-character Apple Developer Team ID
- `TAURI_SIGNING_PRIVATE_KEY` — private key for Tauri updater signatures
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — only if the updater key is encrypted

Because the UI is bundled (`companion/webui`), a web-app change reaches the
native app only when that bundle is refreshed and a new companion release is
built. `.github/workflows/companion-release.yml` now does that on every relevant
push: it installs the root web dependencies, runs
`npm run refresh:companion-webui`, then packages the refreshed bundle into the
signed Tauri release.

## Build

```bash
npm run refresh:companion-webui
cd companion/src-tauri
cargo tauri build      # -> target/release/bundle/dmg/*.dmg
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
