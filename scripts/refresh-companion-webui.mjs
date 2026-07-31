import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const webuiDir = path.join(root, 'companion', 'webui')
const tempWebuiDir = path.join(root, 'companion', '.webui-next')
const backupWebuiDir = path.join(root, 'companion', '.webui-prev')
const tauriConfigPath = path.join(root, 'companion', 'src-tauri', 'tauri.conf.json')
const isVerifyOnly = process.argv.includes('--verify')

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function gitValue(args, fallback = '') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 ? result.stdout.trim() : fallback
}

async function buildInfo() {
  const tauriConfig = await readJson(tauriConfigPath)
  const sha = process.env.EUDONOMIA_BUILD_SHA
    || process.env.GITHUB_SHA
    || await gitValue(['rev-parse', 'HEAD'], 'unknown')
  const shortSha = sha === 'unknown' ? 'unknown' : sha.slice(0, 7)
  const channel = process.env.EUDONOMIA_BUILD_CHANNEL || 'local'
  const runNumber = process.env.GITHUB_RUN_NUMBER || ''
  const buildId = process.env.EUDONOMIA_BUILD_ID
    || (runNumber ? `${channel}-${runNumber}-${shortSha}` : `${channel}-${shortSha}`)

  return {
    version: process.env.EUDONOMIA_BUILD_VERSION || tauriConfig.version,
    channel,
    buildId,
    sha,
    shortSha,
    builtAt: new Date().toISOString(),
  }
}

async function verifyWebui(dir) {
  const indexPath = path.join(dir, 'index.html')
  const assetsDir = path.join(dir, 'assets')
  const buildInfoPath = path.join(dir, 'build-info.json')

  if (!existsSync(indexPath)) {
    throw new Error(`${path.relative(root, indexPath)} is missing`)
  }
  if (!existsSync(assetsDir)) {
    throw new Error(`${path.relative(root, assetsDir)} is missing`)
  }
  if (!existsSync(buildInfoPath)) {
    throw new Error(`${path.relative(root, buildInfoPath)} is missing`)
  }

  const index = await fs.readFile(indexPath, 'utf8')
  if (!index.includes('src="./assets/')) {
    throw new Error('companion webui index does not reference bundled relative JS assets')
  }
  if (!index.includes('href="./assets/')) {
    throw new Error('companion webui index does not reference bundled relative CSS assets')
  }

  // The FaceMesh runtime ships inside the app so it works offline. It is copied
  // out of node_modules at build time and deliberately not committed, so a build
  // that skipped that step would produce an app whose tracking can never start.
  // Fail here rather than shipping it.
  const modelDir = path.join(dir, 'mediapipe')
  if (!existsSync(path.join(modelDir, 'face_mesh.js'))) {
    throw new Error('companion webui is missing the bundled mediapipe runtime — run `npm run mediapipe:copy` then rebuild')
  }
  if (index.includes('cdn.jsdelivr.net')) {
    throw new Error('companion webui still loads MediaPipe from a CDN — the app must run offline')
  }

  const info = await readJson(buildInfoPath)
  for (const key of ['version', 'channel', 'buildId', 'sha', 'shortSha', 'builtAt']) {
    if (!info[key]) {
      throw new Error(`companion webui build-info.json is missing ${key}`)
    }
  }
}

async function refresh() {
  const info = await buildInfo()

  await fs.rm(tempWebuiDir, { recursive: true, force: true })
  await fs.rm(backupWebuiDir, { recursive: true, force: true })

  run('npm', ['run', 'build'], {
    env: {
      VITE_EUDONOMIA_BUILD_VERSION: info.version,
      VITE_EUDONOMIA_BUILD_CHANNEL: info.channel,
      VITE_EUDONOMIA_BUILD_ID: info.buildId,
      VITE_EUDONOMIA_BUILD_SHA: info.sha,
      VITE_EUDONOMIA_BUILD_SHORT_SHA: info.shortSha,
      VITE_EUDONOMIA_BUILT_AT: info.builtAt,
    },
  })

  await fs.writeFile(path.join(distDir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`)
  await verifyWebui(distDir)
  await fs.cp(distDir, tempWebuiDir, { recursive: true })
  await verifyWebui(tempWebuiDir)

  try {
    if (existsSync(webuiDir)) {
      await fs.rename(webuiDir, backupWebuiDir)
    }
    await fs.rename(tempWebuiDir, webuiDir)
  } catch (err) {
    if (!existsSync(webuiDir) && existsSync(backupWebuiDir)) {
      await fs.rename(backupWebuiDir, webuiDir)
    }
    throw err
  } finally {
    await fs.rm(backupWebuiDir, { recursive: true, force: true })
    await fs.rm(distDir, { recursive: true, force: true })
  }

  console.log(`refreshed companion/webui ${info.version} ${info.buildId}`)
}

try {
  if (isVerifyOnly) {
    await verifyWebui(webuiDir)
    console.log('companion/webui verified')
  } else {
    await refresh()
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
