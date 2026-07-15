# Eudaimonia — Focus Session Tracker

A webcam-powered focus session app that tracks attention in real time using eye-tracking and face detection.

## Tech Stack

- **Frontend:** React + Vite
- **Eye tracking:** face-api.js (TensorFlow.js)
- **Storage:** localStorage (no backend)
- **Deployment:** Vercel

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Browser Extension (required for activity tracking)

The Eudonomia Focus Tracker extension tracks your active browser tab
to enable accurate focus/distraction detection.

### Install:

1. Open Chrome -> chrome://extensions
2. Enable Developer Mode (top right)
3. Click "Load unpacked"
4. Select the `extension/` folder from this repo
5. Pin the extension to your toolbar

Works with: Chrome, Brave, Arc, Edge
Safari: requires separate setup (coming soon)

## Deployment (Vercel)

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import this repository from GitHub
3. Vercel auto-detects Vite — no config needed (vercel.json is already set)
4. Click **Deploy**

### Environment Variables

None required. The app runs entirely in the browser.

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
