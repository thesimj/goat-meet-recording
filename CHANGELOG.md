# Changelog

All notable changes to GoatMeet are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow the `version` field in `extension/manifest.json`.

## [Unreleased]

## [0.3.6] - 2026-09-17

### Changed

- Generalized the documentation to recording any tab in Chrome, not only a meeting tab.
- Moved the README banner to `images/` and removed the `docs/` directory, including the store listing draft and the testing guide.

## [0.3.5] - 2026-09-17

### Changed

- Redesigned the popup while recording. Stop and the microphone now share one row. The microphone is a compact icon button, not a second full-width button. It shows a plain mic when live and a slashed amber mic when muted, and keeps its `aria-label`, `aria-pressed`, and tooltip.
- The header shows the goat logo instead of a large letter.
- Removed the footer line from the popup.
- Generalized the wording to recording any tab, not only a meeting tab. The manifest description, popup, access page, settings page, toolbar tooltip, and error messages now say "tab". Meeting-provider filename detection for Google Meet, Microsoft Teams, and Zoom is unchanged.

## [0.3.4] - 2026-09-17

### Fixed

- The toolbar showed a stuck amber `!` with "Folder access needed" after folder access was already granted. The service worker cannot confirm a directory handle's permission, because that permission is tracked per window, so its check always failed. The worker now judges the folder by whether one is selected and leaves the real permission check to the popup, which runs in a window.

## [0.3.3] - 2026-09-17

### Fixed

- The access flow closed the entire browser on some Chrome builds. Two changes fix it. The access flow opens as a normal tab instead of a popup window, and it closes by removing its own tab by id rather than calling `window.close()`, which was observed to quit Chrome. Closing the access tab can never affect another tab or window now.

## [0.3.1] - 2026-09-17

First public source release, prepared for the Chrome Web Store.

### Changed

- Removed the `tabs` permission. GoatMeet no longer shows the “Read your browsing history” install warning. Chrome now shares a tab address only after you click the GoatMeet icon on that tab, so the toolbar badge assumes a normal web page until then. The popup still validates the real address.
- Reorganized the code. The unpacked extension lives in `extension/`, shared modules in `extension/lib/`, and tests in `tests/`.
- Split `settings.mjs` into `storage.mjs` (IndexedDB) and `filenames.mjs` (meeting detection and file naming).
- Added `shared.mjs` and `messaging.mjs` for helpers that five files used to duplicate: phase checks, elapsed time, access checks, folder selection, and the message reply shape.
- Reformatted every module to one statement per line and extracted small named functions from the long start-up routines.
- Added `homepage_url` to the manifest and clarified the store description.
- The popup checks folder and microphone access before it renders and once a second. The button always reads **Start recording**. When access is missing, pressing it opens a small window that requests only what is missing and then records. When access is present, it records at once with no window.

### Added

- `npm run package` builds `dist/goatmeet-<version>.zip` with a dependency-free ZIP writer.
- `npm run check` syntax-checks every script and validates every JSON file.
- Tests for the service worker, the settings page, the shared helpers, the manifest, and the package. 65 tests in total, up from 25.
- `npm run e2e` runs a smoke test in a real Chrome through the DevTools protocol: every page, the message routes, and the encoder check.
- GitHub Actions workflow: tests on Node 22 and 24, package build, and release upload on `v*` tags.
- `PRIVACY.md`, `CONTRIBUTING.md`, `SECURITY.md`, a store listing draft, and a testing guide.
- A recording consent note in the README and the privacy policy.
- A README hero illustration in `images/`, generated with GPT Image 2.5 from the extension’s icon and palette.

### Fixed

- A start request for a tab whose address Chrome withholds now explains how to grant access instead of reporting an unsupported tab.
- A failed start, or a failure before the first five-minute commit, no longer leaves a zero-byte MP4 in the recording folder.
- After a recording ends, the popup button reads **Start recording**, not the access label. It no longer reverts when a recording was begun from the access window.
- An error from a popup button stays visible until the next press or a recorder phase change. The one-second status poll used to erase it.
- Stopping fires the "stopping" state once. Chrome's own stop event used to fire it a second time and move the end timestamp.
- The service worker uses the state carried by each recorder update instead of asking the recorder again, and the popup asks for a toolbar redraw only when the access state changes.

## [0.2.6] - 2026-09-17

Internal version before the public repository. Recorded a meeting tab plus microphone to an H.264/AAC MP4 with five-minute checkpoints, a combined access flow, meeting-aware filenames, and a status badge on the toolbar.

[Unreleased]: https://github.com/thesimj/goat-meet-recording/compare/v0.3.6...HEAD
[0.3.6]: https://github.com/thesimj/goat-meet-recording/releases/tag/v0.3.6
[0.3.5]: https://github.com/thesimj/goat-meet-recording/releases/tag/v0.3.5
[0.3.4]: https://github.com/thesimj/goat-meet-recording/releases/tag/v0.3.4
[0.3.3]: https://github.com/thesimj/goat-meet-recording/releases/tag/v0.3.3
[0.3.1]: https://github.com/thesimj/goat-meet-recording/releases/tag/v0.3.1
