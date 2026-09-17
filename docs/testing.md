# Testing GoatMeet

Four layers of checks exist. Run the first two before every pull request. Run all four before every release.

## 1. Node tests

```text
npm run check
npm test
```

`check` syntax-checks every script and parses every JSON file.
`test` runs the suites in `tests/`. They cover:

| File | Covers |
| --- | --- |
| `background.test.mjs` | Command routing, tab validation, offscreen document reuse, toolbar redraws, sender filtering |
| `filenames.test.mjs` | Provider detection, passcode stripping, slug sanitizing, `-2` suffixes |
| `manifest.test.mjs` | Manifest V3 limits, minimal permissions, every referenced file and import exists, no stray files in `extension/` |
| `package.test.mjs` | CRC32, ZIP round trip, store zip content |
| `permissions.test.mjs` | The combined access flow, denial and cancel paths, auto-start |
| `popup.test.mjs` | Start enablement, access guidance, recording display, stop and mute |
| `recording.test.mjs` | Codec requirement, audio routing, mute, chunk ordering, write and encoder failures |
| `setup.test.mjs` | Folder choice, display path, microphone toggle and device list |
| `shared.test.mjs` | Pure helpers |
| `toolbar.test.mjs` | Badge priority, tri-state tab support, icon drawing |
| `writer.test.mjs` | Periodic commits, reopen offset, abort |

Chrome APIs do not exist in Node. Page scripts run inside a `vm` context through `tests/helpers/page.mjs`, which strips their imports and supplies real pure helpers plus fakes for `chrome`, `document`, and `navigator`.

## 2. Browser encoder check

This check proves that the installed Chrome can encode H.264 + AAC MP4 and that the checkpoint writer produces a playable file. It uses a generated picture and two generated tones. It does not touch a meeting or your microphone.

1. From the repository root, run `npm run browser-check`. It starts a local web server on port 8765.
2. Open `http://127.0.0.1:8765/tests/browser/browser.html` in Chrome.
3. Click **Run recording check**.

Expected result: `PASS: video/mp4;codecs=avc1,mp4a.40.2; <bytes> bytes; 2 disk commits; 640×360; MP4 playback loaded.`
The check writes to a browser-owned file in the origin private file system, not to your disk.

## 3. Automated smoke test in Chrome

```text
npm run e2e
```

`tests/e2e/smoke.mjs` starts Google Chrome with a temporary profile, loads `extension/` through the DevTools protocol, and checks:

- the service worker runs the packaged manifest without the `tabs` permission,
- the encoder check page produces a playable H.264/AAC MP4 with two disk commits,
- the toolbar shows the amber access hint for a tab whose URL Chrome withholds,
- the popup, settings page, and access window load without console errors and show the expected text,
- the status, start, and stop message routes reply with the expected results,
- a settings change is visible in the popup and the access window.

It needs Google Chrome on the machine. Set `CHROME` to the executable path if it is not in a standard location.
Chrome 137 and later ignore `--load-extension` in branded builds, so the script uses `Extensions.loadUnpacked` with `--enable-unsafe-extension-debugging` instead.

The script cannot click the real toolbar icon, so it cannot grant `activeTab` or start a capture. Those steps stay manual.

## 4. Manual extension check

Do this in a fresh Chrome profile before each store upload. It takes about ten minutes.

### Install

1. Load `extension/` unpacked at `chrome://extensions`.
2. Confirm the install shows one permission warning: “Read and change all your data on all websites”. There must be no “Read your browsing history” warning.
3. Pin the icon. Before any click the badge shows the access state, amber `!` on a fresh profile. On `chrome://extensions` the popup says to select a meeting tab.

### First recording

1. Open any `https://` page with sound, for example a video.
2. Click GoatMeet. The status says to press Start to allow folder selection and microphone access. The badge is amber `!`.
3. Press **Start recording**. The access window opens.
4. Click **Allow and record**. Select your Videos folder. Approve the microphone.
5. The window closes on its own. The badge is red `REC`. `Videos/goatmeet` contains a new MP4 that grows.
6. Close the popup, switch tabs, and come back. The badge stays red and the tooltip shows elapsed time.
7. Press **Mute recording mic**. The tooltip adds “recording mic muted”.
8. Press **Stop recording**. The badge shows blue `SAVE`, then green `✓` for five seconds.
9. Play the MP4. Expect tab audio, your voice before the mute, and no voice after it.

### Failure paths

1. Deny the folder prompt. The window stays open with an error. No file appears.
2. Cancel the folder picker. The status says “Cancelled. No recording started.”
3. Deny the microphone. The window shows a **Chrome microphone settings** button. No recording starts.
4. Close the captured tab during a recording. The badge turns to `SAVE`, then amber `!`. The saved file plays up to the close.
5. Disable **Include my microphone** in settings. Start records with the folder prompt only, and the popup says “Recording tab audio only”.

### Long recording

Record for at least six minutes once. The popup’s **Last disk save** time must update after five minutes. Kill Chrome from the task manager during minute seven. The file must play up to the five-minute commit, possibly after a repair with a tool such as `ffmpeg -i broken.mp4 -c copy fixed.mp4`.

## History

Results from the version before the public repository (0.2.6, Chrome 153 on Windows):

- 25 Node tests passed.
- The browser check produced native H.264 with two disk commits.
- An automated extension run captured a synthetic tab with a simulated microphone, survived closing the popup, navigation within the tab, and a forced service worker stop, and produced 1920 × 1080 H.264 with stereo 48 kHz AAC.
- The real toolbar popup started, closed, reopened, and stopped a recording, and the combined access flow worked with a browser-owned folder and an automated microphone grant.
- Badge colors were confirmed for permission needed, recording across tab switches, saved, ready, and unsupported.

Real folder prompts, physical microphones, actual meeting providers, and hour-long recordings were tested by hand.
