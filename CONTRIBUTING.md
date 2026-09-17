# Contributing to GoatMeet

Thank you for helping. This page explains how the project works and what a good change looks like.

## Principles

- **No build, no dependencies.** The extension is plain JavaScript modules that Chrome loads as they are. Pull requests that add a bundler, a framework, or a runtime dependency will not be merged.
- **No network.** The Content Security Policy forbids network requests. Keep it that way.
- **Minimal permissions.** Every permission needs a sentence in `PRIVACY.md` explaining why. Do not add one without opening an issue first.
- **Honest error paths.** A failed write must never report a saved file. Tests exist for this. Keep them passing.

## Setup

1. Install Node 22 or later. No `npm install` is needed.
2. Clone the repository.
3. Load `extension/` as an unpacked extension at `chrome://extensions`.

## Checks

Run these from the repository root before opening a pull request.

```text
npm run check
npm test
npm run package
```

`npm test` runs the Node tests. They load each page script into a `vm` context with fake browser objects, so they run in under a second and need no Chrome.
For changes to pages or the service worker, also run `npm run e2e`. It starts a real Chrome with the extension loaded.
For changes to capture, encoding, or file writing, also run the browser check described in [docs/testing.md](docs/testing.md).

## Layout

```text
extension/manifest.json   permissions, pages, and the version
extension/background.js   service worker: routes commands, draws the toolbar
extension/offscreen.mjs   owns the capture, mix, encoder, and writer
extension/popup.mjs       toolbar popup
extension/permissions.mjs combined folder and microphone access window
extension/setup.mjs       options page
extension/lib/            pure modules shared by the above
tests/                    one test file per module or page
tests/helpers/page.mjs    loads a page script with fake globals
scripts/                  check.mjs and package.mjs
```

Pages import from `./lib/`. Modules in `lib/` never import from pages.
Only `messaging.mjs`, `storage.mjs`, and `toolbar.mjs` touch browser globals. The rest of `lib/` is pure and tested directly.

## Style

- One statement per line. Lines under 120 characters.
- `const` by default. Small named functions over long inline blocks.
- User-facing text is plain English with short sentences. Say what happened and what to do next.
- Comments explain a decision Chrome forces on us, not what the code does.
- Documentation uses short sentences, one idea each, active voice.

## Tests

Add or update a test with every behavior change. Match the existing pattern:

- Pure modules are imported and tested directly.
- Page scripts run through `runPage()` from `tests/helpers/page.mjs`. Pass real helpers from `shared.mjs` and stubs for anything that touches `chrome`, `document`, or `navigator`.
- Assert on user-visible text and on the calls made to Chrome, not on internals.

## Versions and releases

1. Bump `version` in `extension/manifest.json` and `package.json` together.
2. Add a section to `CHANGELOG.md`.
3. Tag the commit `v<version>` after merging. CI attaches the store zip to the GitHub release.
4. Upload that zip to the Chrome Web Store developer dashboard.

The Chrome Web Store rejects an upload whose version is not higher than the published one.

## Reporting problems

Open an issue with your Chrome version, operating system, and the exact status text GoatMeet showed.
Do not attach recordings. Security problems go through [SECURITY.md](SECURITY.md).
