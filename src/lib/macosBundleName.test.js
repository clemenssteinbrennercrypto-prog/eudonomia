import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fromRepo = (path) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')

describe('macOS bundle display name', () => {
  it('keeps existing Eudonomia.app installs visibly named Eudaimonai', () => {
    const config = JSON.parse(fromRepo('companion/src-tauri/tauri.conf.json'))
    const infoPlist = fromRepo('companion/src-tauri/Info.plist')

    expect(config.productName).toBe('Eudaimonai')
    expect(config.identifier).toBe('ai.eudonomia.companion')
    for (const language of ['de', 'en']) {
      expect(
        config.bundle.resources[
          `resources/infoplist/${language}.lproj/InfoPlist.strings`
        ],
      ).toBe(`${language}.lproj/InfoPlist.strings`)
    }
    expect(infoPlist).toMatch(
      /<key>CFBundleDisplayName<\/key>\s*<string>Eudonomia<\/string>/,
    )
    expect(infoPlist).toMatch(
      /<key>LSHasLocalizedDisplayName<\/key>\s*<true\s*\/>/,
    )

    for (const language of ['de', 'en']) {
      const localizedInfo = fromRepo(
        `companion/src-tauri/resources/infoplist/${language}.lproj/InfoPlist.strings`,
      )
      expect(localizedInfo).toContain(
        '"CFBundleDisplayName" = "Eudaimonai";',
      )
      expect(localizedInfo).toContain('"CFBundleName" = "Eudaimonai";')
    }
  })
})
