# Eudaimonia — Companion-first Focus Tracker

Eudaimonia is a native macOS Companion app for focus sessions. The React UI is
bundled into the Companion, while the public website should explain the vision
and route users to the app download.

## Tech Stack

- **Companion:** Tauri macOS app in `companion/`
- **UI:** React + Vite, bundled into `companion/webui`
- **Attention tracking:** MediaPipe in the local WebView
- **Activity/blocking:** in-process Rust commands and Tauri events
- **Marketing site:** Vercel surface for product explanation and downloads

## Local Development

```bash
npm install
npm run dev
```

Open the Vite development URL for isolated UI iteration only. It is not a
standalone product and native activity, output evidence, helper installation,
and blocking intentionally stay unavailable there. For the actual product
runtime, build/run the Companion from `companion/src-tauri`.

## Native Companion

The Companion is the primary runtime. It hosts the UI, detects the frontmost app
and browser tab via AppleScript, and enforces app/website blocking during a
session.

```bash
npm run refresh:companion-webui
cd companion/src-tauri
cargo tauri build
```

Native releases are produced by `.github/workflows/companion-release.yml`. The
workflow runs only from `release-v*` tags or manual dispatch, rebuilds
`companion/webui` from the root Vite app, applies the production Tauri overlay,
then signs, notarizes, verifies, and publishes the macOS bundle.

Pushes to `main` use `.github/workflows/companion-test.yml`. That workflow
refreshes and verifies the bundled UI, builds unsigned internal macOS artifacts,
uploads them as GitHub Actions artifacts, and publishes updater artifacts to the
`internal-test` prerelease using `TAURI_SIGNING_PRIVATE_KEY`. These test builds
are for internal validation; public downloads and production native updater
metadata still come from production releases.

The native app displays a small build/version badge. Use it, or inspect
`companion/webui/build-info.json`, to confirm a fresh build contains the commit
or workflow run you expected.

The old browser extension source remains archived in `extension/`, but it is not
built, wired into the app, or a supported product path.

## Website Deployment (Vercel)

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import this repository from GitHub
3. Vercel auto-detects Vite — no config needed (vercel.json is already set)
4. Click **Deploy**

### Environment Variables

None required for the marketing/download surface. Native activity tracking and
blocking require the Companion runtime.

### Build Settings (auto-detected via vercel.json)

| Setting | Value |
|---|---|
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Framework | Vite |

## Features

- Real-time focus scoring via webcam (PERCLOS, blink rate, head pose)
- Session history with timeline charts
- Flow state detection
- Break reminders
- CSV export
- Dark mode ambient display
