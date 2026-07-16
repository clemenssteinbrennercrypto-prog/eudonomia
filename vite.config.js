import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function getBuildId() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA
  }

  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return `local-${Date.now()}`
  }
}

function buildInfoPlugin(buildInfo) {
  return {
    name: 'eudaimonia-build-info',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: `${JSON.stringify(buildInfo, null, 2)}\n`,
      })
    },
  }
}

const buildInfo = {
  buildId: getBuildId(),
  builtAt: new Date().toISOString(),
}

export default defineConfig({
  // Relative asset paths so the same build works both on Vercel (served at /)
  // and bundled into the native app (loaded from the app's local origin).
  base: './',
  define: {
    __EUDAIMONIA_BUILD_ID__: JSON.stringify(buildInfo.buildId),
  },
  plugins: [react(), buildInfoPlugin(buildInfo)],
})
