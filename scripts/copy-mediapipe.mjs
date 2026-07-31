// Copies the MediaPipe FaceMesh runtime out of node_modules into public/, so the
// app serves the model from its own origin instead of a CDN.
//
// Why this matters beyond reliability: Eudaimonia's core promise is that nothing
// leaves your machine. Fetching ~16 MB of model from jsdelivr on every session
// start contradicted that, and made the app unusable offline or behind a
// firewall / content blocker.
//
// The files are NOT committed (public/mediapipe is gitignored) — this runs
// automatically before `npm run dev` and `npm run build`.

import { mkdir, readdir, copyFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', '@mediapipe', 'face_mesh')
const dest = join(root, 'public', 'mediapipe')

// Everything the solution loader can request at runtime. The package also ships
// README.md / package.json / index.d.ts, which the browser never asks for.
const SKIP = new Set(['README.md', 'package.json', 'index.d.ts'])

if (!existsSync(src)) {
  console.error('[mediapipe] @mediapipe/face_mesh is not installed — run `npm install` first.')
  process.exit(1)
}

await mkdir(dest, { recursive: true })

let copied = 0
let bytes = 0
for (const name of await readdir(src)) {
  if (SKIP.has(name)) continue
  const from = join(src, name)
  const to = join(dest, name)
  const info = await stat(from)
  if (!info.isFile()) continue
  // Skip files that are already present and the same size — keeps dev startup fast.
  if (existsSync(to) && (await stat(to)).size === info.size) continue
  await copyFile(from, to)
  copied += 1
  bytes += info.size
}

console.log(copied === 0
  ? '[mediapipe] runtime already in public/mediapipe — nothing to copy'
  : `[mediapipe] copied ${copied} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB → public/mediapipe`)
