# Release-readiness evidence — 2 September 2026

This is a point-in-time checklist for commit `ab3a07fb4e28a7316a63ef9b6a70406c11e3e17f` (`ab3a07f`). It records what was verified from the Mac Mini/build worktree and what still requires a real target Mac, a human decision, or protected release credentials.

## Evidence collected

| Gate | Result | Evidence |
| --- | --- | --- |
| Worktree synchronization | Pass with caveat | Worktree was clean and `HEAD` matched `origin/main` at `ab3a07f`. `git pull --ff-only` could not run because this local branch has no upstream configured; no merge was attempted. |
| JavaScript tests | Pass | `npm test -- --reporter=dot`: 37 test files, 442 tests passed. |
| Web production build | Pass | `npm run build` completed successfully. Existing warnings: non-module MediaPipe script tags and two chunks over 500 kB. |
| Latest CI test/build | Pass | GitHub Actions run `33537175187`, Test Companion, commit `ab3a07f`, completed successfully. Its unit tests, Rust tests, companion UI refresh/verification, updater-secret check, arm64 build, artifact upload, and internal-channel publication steps all passed. |
| Internal updater channel | Pass/current | `internal-test/latest.json` is version `0.1.2609011731`, published 2026-09-01 17:36 UTC, and names commit `ab3a07f` in its notes. It advertises only `darwin-aarch64` and has a non-empty signature. |
| Native Rust checks on this machine | Pass | The Cargo proxy exists outside the shell `PATH`. `~/.cargo/bin/cargo check` completed successfully, and `~/.cargo/bin/cargo test` passed 13 library plus 59 app tests (72 total). |
| Checked-in companion bundle | Not ready locally | `npm run verify:companion-webui` fails because `companion/webui` lacks bundled MediaPipe runtime files. The CI refresh step succeeds and produces the required generated bundle; no generated artifact was committed here. |

## Release blockers and open verification

### Human-owned blockers

- The Impressum still needs Clemens' geographic address (street, number, postcode, and `Wien, Österreich`), as required by Austrian ECG §5. Do not invent or publish a placeholder.
- Apple Developer Program enrollment and release credentials remain required for a public signed/notarized build: Developer ID certificate, notarization account/app-specific password/team ID, and Tauri updater signing key. Secret presence cannot be verified from this worktree.
- A nominated output-watch folder is required before output evidence can be judged in real use.

### Hardware/manual gates

- The native V2 minimize/close live-session gate is recorded as passed on the target MacBook Air on 31 August. This worktree cannot independently reproduce it.
- Hard camera removal, sleep/lid-close recovery, CPU/energy impact, and a clean first-run permission path remain unverified here. They require the target Apple Silicon Mac and manual interaction; do not infer them from CI.
- The recorded-frame parity harness remains characterization/regression evidence. Native V2 is a versioned ruler, not a claim of V1/WebGL parity.

## Channel warning

The production updater manifest is still `0.1.10`, published 16 July 2026, while the internal channel is current through `ab3a07f`. The checked-in base config points at `internal-test`; the production config points at `releases/latest`. Therefore a tester must confirm the installed build's channel and build badge before expecting this commit to appear. No production release was created or published during this audit.

## Safe next actions

1. On a target MacBook Air, manually run the hard camera-loss, sleep/wake, permission, and resource-impact checks and attach dated evidence.
2. Supply the legal address and complete Apple Developer/release-secret setup.
3. On a clean checkout, run `npm ci`, `npm test`, `npm run refresh:companion-webui`, `npm run verify:companion-webui`, `~/.cargo/bin/cargo test --manifest-path companion/src-tauri/Cargo.toml`, and the arm64 release build; inspect the build badge and updater channel before installation.
4. Only after those gates pass should an authorized release owner create a `release-v*` tag and publish the signed production draft.
