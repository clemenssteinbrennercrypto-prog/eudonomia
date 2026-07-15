# Eudonomia Companion

A tiny macOS menubar app that feeds desktop activity into
[Eudonomia](https://eudonomia.vercel.app) — the webcam-based focus tracker.

## What it does

- Lives in the **menubar only** (no Dock icon)
- Every **3 seconds** it detects the frontmost app and — for Safari, Chrome,
  Arc, and Brave — the active tab's URL, via AppleScript
- Serves the result as JSON on **`http://localhost:7331/status`** (CORS open),
  which the Eudonomia web app polls during a focus session
- Click the menubar icon for a small popup showing what's currently tracked;
  right-click for the Quit menu

No data leaves your machine. The server binds to `127.0.0.1` only.

## Build

Requires Rust (`rustup`) and the Tauri CLI:

```bash
cargo install tauri-cli --locked
cd eudonomia-companion/src-tauri
cargo tauri build
```

The `.dmg` lands in `src-tauri/target/release/bundle/dmg/`.

For a quick dev run without bundling:

```bash
cd eudonomia-companion/src-tauri
cargo tauri dev
```

## Install

1. Open the `.dmg` and drag **Eudonomia Companion** to Applications
2. First launch: right-click → Open (unsigned app), confirm in
   System Settings → Privacy & Security if prompted
3. Grant the two permission prompts:
   - **Accessibility / Automation → System Events** (frontmost-app detection)
   - **Automation → Safari / Chrome** (tab URL detection)

## How it connects to Eudonomia

The web app's activity receiver polls `http://localhost:7331/status` every few
seconds. When the Companion is running, Eudonomia automatically classifies the
active app/site as focus or distraction based on your Focus Apps configuration
— no extra setup needed.

Response shape:

```json
{
  "app": "Safari",
  "window": "YouTube",
  "url": "https://www.youtube.com/watch?v=abc",
  "domain": "youtube.com",
  "ts": 1720000000000
}
```
