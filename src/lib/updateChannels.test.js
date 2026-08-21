import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function readConfig(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
}

describe('native updater channels', () => {
  it('keeps local and internal builds on the moving main-branch channel', () => {
    const base = readConfig('../../companion/src-tauri/tauri.conf.json')
    const test = readConfig('../../companion/src-tauri/tauri.test.conf.json')
    const internalEndpoint = 'https://github.com/clemenssteinbrennercrypto-prog/eudonomia/releases/download/internal-test/latest.json'

    expect(base.plugins.updater.endpoints).toEqual([internalEndpoint])
    expect(test.plugins.updater.endpoints).toEqual([internalEndpoint])
  })

  it('keeps signed production releases on the production channel', () => {
    const release = readConfig('../../companion/src-tauri/tauri.release.conf.json')

    expect(release.plugins.updater.endpoints).toEqual([
      'https://github.com/clemenssteinbrennercrypto-prog/eudonomia/releases/latest/download/latest.json',
    ])
  })
})
