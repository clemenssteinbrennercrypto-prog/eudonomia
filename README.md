# Eudaimonia — Companion-first Focus Tracker

Eudaimonia is a native macOS Companion app for focus sessions. The React UI is
bundled into the Companion, while the public website should explain the vision
and route users to the app download.

## Tech Stack

- **Companion:** Tauri macOS app in `companion/`
- **UI:** React + Vite, bundled into `companion/webui`
- **Attention tracking:** MediaPipe in the local WebView
- **Activity/blocking:** native Companion service on localhost:7331
- **Marketing site:** Vercel surface for product explanation and downloads

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) for UI iteration. For the
actual product runtime, build/run the Companion from `companion/src-tauri`.

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
workflow rebuilds `companion/webui` from the root Vite app before Tauri packages
the macOS bundle, so a pushed UI change reaches the installed app only after the
workflow publishes a signed Companion release and the app installs that update.

The old browser extension remains in `extension/` as a legacy fallback for
experiments, but it is not the product path and should not be presented as
required setup.

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
