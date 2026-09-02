import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The WebView CSP is what makes "cloud credentials are native-only" real: with
// it, no key and no Anthropic request can originate in the WebView even if a
// later change puts one there. These tests hold both halves of that policy —
// what it must forbid, and what it must still allow.
const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../companion/src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
)
const csp = config.app.security.csp

function directive(name) {
  const found = csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `))
  return found ? found.slice(name.length + 1).trim().split(/\s+/) : null
}

describe('WebView content security policy', () => {
  it('is set at all — a null CSP lets the WebView reach any host', () => {
    expect(typeof csp).toBe('string')
    expect(directive('default-src')).toEqual(["'self'"])
  })

  it('cannot reach Anthropic from the WebView: cloud egress is the native command', () => {
    const connect = directive('connect-src')
    expect(connect).not.toBeNull()
    expect(csp).not.toContain('api.anthropic.com')
    // Ollama is on the device and stays reachable; nothing else off-device is.
    expect(connect.filter(source => /^https?:\/\//.test(source)))
      .toEqual(['http://ipc.localhost', 'http://127.0.0.1:11434'])
  })

  it('loads no script from another origin', () => {
    const script = directive('script-src')
    expect(script).not.toBeNull()
    expect(script.filter(source => !source.startsWith("'"))).toEqual([])
  })

  // Verified in WKWebView against the bundled 0.4.1633559619 assets: emscripten's
  // embind builds its error classes with `new Function` while the module
  // initialises, so without 'unsafe-eval' FaceMesh.initialize() rejects with an
  // EvalError. That breaks workspace calibration — which is on the first-run
  // path — and the recorded-frame parity harness. 'wasm-unsafe-eval' does NOT
  // cover it: it permits WebAssembly compilation only, never string-to-JS.
  it("keeps 'unsafe-eval', which bundled MediaPipe FaceMesh.js needs to initialise", () => {
    expect(directive('script-src')).toContain("'unsafe-eval'")
  })
})
