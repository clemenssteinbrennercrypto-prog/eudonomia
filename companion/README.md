# Eudonomia (native macOS app)

A native macOS app (Tauri) that embeds the Eudonomia React interface in its own
WebView and enforces distraction blocking on the whole machine. The native app
is the product; there is no standalone browser-app runtime.

## What it does

- **Hosts the UI** in its own window from a **locally bundled** copy of the web
  app (`companion/webui`) — no browser and no extension. A menubar tray gives
  quick open/quit.
- **Detects the frontmost app + browser tab URL** every 3 seconds via AppleScript
  (Safari, Chrome, Arc, Brave) and emits the result only to the bundled WebView
  through a Tauri event.
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
See `.github/workflows/companion-release.yml`, which runs only for `release-v*`
tags or manual release dispatches. It builds a universal macOS DMG, signs it
with a Developer ID Application certificate, notarizes it, staples the
notarization ticket, verifies Gatekeeper acceptance, and only then publishes the
GitHub Release.

The user-facing download is the `.dmg` asset from the latest Companion release.
The `.app.tar.gz`, `.sig`, and `latest.json` assets are updater inputs and
should not be presented as manual-install downloads.

Pushes to `main` use `.github/workflows/companion-test.yml` instead. That
workflow refreshes and verifies the bundled UI, builds unsigned internal macOS
artifacts, uploads them as workflow artifacts, and publishes updater artifacts
to the moving `internal-test` prerelease using `TAURI_SIGNING_PRIVATE_KEY`.
Local and test-channel builds poll `releases/download/internal-test/latest.json`
so the in-app update button follows the newest build from `main`. Production
builds override that endpoint through `src-tauri/tauri.release.conf.json` and
only install published production releases.

The native updater also compares release publication time with the bundled UI's
`builtAt` value. A numerically higher SemVer from an older channel is refused,
so a local or CI build can never update back to an older interface merely
because the two channels use different version schemes.

This internal channel still needs Tauri updater signing, because Tauri refuses
to install unsigned updater archives. It intentionally does not require Apple
Developer ID signing or notarization. That makes it practical for internal
testing, but macOS may still show normal warnings for unsigned apps.

Release publishing requires these GitHub Actions secrets:

- `APPLE_CERTIFICATE` — base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD` — password for that `.p12`
- `APPLE_SIGNING_IDENTITY` — `Developer ID Application: ... (TEAMID)`
- `APPLE_ID` — Apple Developer account email for notarization
- `APPLE_PASSWORD` — app-specific password for `APPLE_ID`
- `APPLE_TEAM_ID` — 10-character Apple Developer Team ID
- `TAURI_SIGNING_PRIVATE_KEY` — private key for Tauri updater signatures
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — only if the updater key is encrypted

Because the UI is bundled (`companion/webui`), a web-app change reaches a native
build only when that bundle is refreshed before packaging. Both Companion
workflows run `npm run refresh:companion-webui` followed by
`npm run verify:companion-webui`. The refresh script builds the root Vite app,
writes `companion/webui/build-info.json`, verifies relative bundled assets, and
then swaps the bundle directory into place.

The base Tauri config is internal-build friendly: unsigned builds use the
internal updater channel, do not create updater artifacts, and do not opt into
hardened runtime or entitlements. The test workflow adds
`src-tauri/tauri.test.conf.json`, which enables updater artifacts. The
production release workflow adds `src-tauri/tauri.release.conf.json`, which
switches back to the production updater endpoint and enables updater artifacts,
macOS hardened runtime, and entitlements.

## Build

```bash
npm run refresh:companion-webui
npm run verify:companion-webui
cd companion/src-tauri
cargo tauri build      # unsigned internal build
cargo tauri build --config tauri.test.conf.json  # internal updater channel
cargo tauri build --config tauri.release.conf.json  # production config shape
cargo test             # pure blocking/scoring logic
```

The app shows a small build badge in the lower-left corner, for example
`test v0.1.123 · abc1234`. For a fresh native build, confirm that badge and
`companion/webui/build-info.json` match the commit or GitHub run you expected.

## How it connects

The bundled WebView and Rust core communicate in-process through Tauri IPC.
No local HTTP server or listening socket is part of the app.

Commands:

- `get_activity_status` — latest frontmost app/browser metadata
- `get_companion_debug` — native protection and permission status
- `get_companion_session` / `set_companion_session` — session and blocking state
- `install_blocking_helper` — one-time privileged helper installation
- `set_output_watch_folder` / `get_output_delta` — metadata-only output evidence

Events:

- `activity-updated` — fresh activity metadata after a native poll
- `session-state-changed` — accepted session changes and native expiry

Private window titles, URLs, activity state, and watched-folder metadata stay
inside the Tauri process/WebView boundary. The Vite browser development view has
no fallback transport and receives none of this data.
