# GoatMeet

![GoatMeet records any tab to a local MP4](images/hero.png)

**Record any tab in your Chrome browser to an MP4 on your own disk. No account, no cloud, no upload.**

GoatMeet is a Chrome extension. Click its icon on any tab, press Start, and the tab records.
It captures the tab’s video and audio together with your microphone, encodes H.264/AAC with Chrome’s own encoder,
and writes the file to a folder you choose while the tab plays. Press Stop and the MP4 is ready to play.
It recognizes Google Meet, Microsoft Teams, and Zoom to name the file, and records any other tab just the same.

- **Local only.** The extension’s Content Security Policy forbids network requests. Nothing ever leaves your computer.
- **Crash safe.** The file commits every five minutes, so a frozen laptop costs minutes, not the whole recording.
- **Named for you.** Files look like `20260917-1132-google-meet-jac-mxgd-uap.mp4`. Passcodes in the URL are never written.
- **Your voice, your choice.** Mute the recording microphone from the popup without touching the page’s mute.
- **Nothing to install besides Chrome.** No build step, no dependencies, plain JavaScript you can read in an afternoon.

GoatMeet is not affiliated with Google, Microsoft, or Zoom.

## Install

### From the Chrome Web Store

The store listing is in preparation. This section will link to it once the extension is published.

### From source

1. Clone this repository.
2. Open `chrome://extensions` in current desktop Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `extension` folder.
5. Pin GoatMeet in Chrome’s extensions menu.

After changing files, click **Reload** on the GoatMeet card. Finish any active recording first.

GoatMeet requires Chrome 126 or later on Windows or macOS. Chrome on Linux does not ship the H.264 encoder, and GoatMeet reports this instead of recording.

## First recording

1. Open the tab you want to record and click the GoatMeet icon.
2. Press **Start recording**.
3. The first time, a new tab opens. Click **Allow and record**.
4. Select your Videos folder. GoatMeet creates a `goatmeet` subfolder inside it.
5. Approve microphone access if Chrome asks.
6. The tab closes and the toolbar shows a red `REC` badge. Carry on in that tab.

The button always reads **Start recording**.
GoatMeet checks folder and microphone access when you open the popup and every second after.
When access is missing, **Start recording** opens a new tab, which requests only what is missing and then records.
Chrome shows its own prompts for the folder and the microphone.
Cancelling or denying either prompt prevents recording.
Once both permissions are granted, **Start recording** records at once without the extra tab.
Chrome’s folder picker needs a click inside a normal page, which is why the popup opens a tab instead of asking directly.

Chrome remembers the folder choice in the extension’s own IndexedDB database.
Chrome may ask you to confirm folder access again after a restart.
The extension cannot grant itself filesystem access.

## Recording workflow

1. Open the tab you want to record.
2. Click GoatMeet and press **Start recording**.
3. Wait for **RECORDING** and the red **REC** badge.
4. Do whatever you want to record in that same tab.
5. At the end, click GoatMeet and press **Stop recording**.
6. Wait for **SAVED**, then open the MP4 in your folder.

You can close the popup, switch tabs, and keep using Chrome while recording.
The recording follows the original tab across navigation within that tab.
It does not follow the content into another tab, another window, or a desktop application.
If an app offers a desktop and a browser version, choose the browser version so it runs in the tab.

GoatMeet records one tab at a time.
Closing the captured tab stops the capture and saves the recording.
Finishing on the page does not always close its tab. Press **Stop recording** when you are done.

## Toolbar badge

| State | Color | Badge |
| --- | --- | --- |
| Ready | Green | None |
| Permission needed | Amber | `!` |
| Starting | Amber | `…` |
| Recording | Red | `REC` |
| Saving | Blue | `SAVE` |
| Saved | Green | `✓` for five seconds |
| Error | Red | `ERR` |
| Unsupported tab | Gray | None |

Hover over the icon for the elapsed time and the mute state of the recording microphone.
An amber `!` after a recording marks a file that ended early or carries another warning.

GoatMeet does not request the `tabs` permission, so Chrome never shows the “Read your browsing history” warning.
In return, Chrome shares a tab’s address with the extension only after you click the GoatMeet icon on that tab.
Until then the badge assumes a normal web page and shows the access state. The popup checks the real address when it opens.

## Folders and filenames

The default destination is `Videos/goatmeet`. On Windows this is normally `%USERPROFILE%\Videos\goatmeet`.
Change the destination in **Recording settings**. You can select any folder and skip the subfolder.

Chrome exposes the selected folder’s name, not its full path.
To see full video paths in the settings page, paste the folder’s path into **Full folder path**.
That field is display-only. It does not change or verify the recording destination.

Filenames use your computer’s local time:

```text
20260917-1132-google-meet-jac-mxgd-uap.mp4
20260917-1132-zoom-12345678901.mp4
20260917-1132-microsoft-teams-1234567890123.mp4
20260917-1132-chrome-meeting.mp4
```

The pattern is `YYYYMMDD-HHmm-<service>-<id>.mp4` when GoatMeet recognizes the tab’s URL.
GoatMeet reads the URL once, when recording starts. It ignores query parameters, so embedded passcodes never reach the filename.
Unknown services use `chrome-meeting` without an id.
If the name exists, GoatMeet appends `-2`, `-3`, and so on. It never overwrites a previous recording.

## Long recordings and periodic saves

GoatMeet receives an encoded chunk about once per second and writes it in order.
It commits the file about every five minutes and when you stop.
A commit closes the file, then reopens it and appends at the previous offset.
The popup shows the time of the last commit.

After a crash, the file holds the data up to the last commit.
Data after that commit is lost. The first five minutes have no checkpoint.
An interrupted MP4 may need a repair tool, because the encoder never wrote its final index.

The default request is 1080p at 30 fps, 4 Mbps video, and 128 kbps audio.
Chrome picks the actual resolution and bitrate within its limits.
One hour at the requested bitrate is about 1.86 GB.
Keep Chrome running and stop your computer from sleeping during a recording.

## Audio

GoatMeet mixes tab audio and your microphone into one audio track.
It captures what the tab shows, including chat or captions inside the page.
It does not produce separate participant tracks.

**A page’s own mute button does not mute GoatMeet’s microphone.**
Use **Mute recording mic** in the popup to leave your voice out while keeping the tab audio.
Disable **Include my microphone** in settings to record tab audio only.
Use headphones to stop the tab audio from leaking back into your microphone.

## Recording consent

Recording a conversation is regulated in many countries and states.
Some require the consent of every participant. GoatMeet does not notify participants and does not trigger any recording indicator.
You are responsible for informing participants and for following the law where you and they are located.

## Privacy

GoatMeet stores recordings only in the folder you choose. It sends nothing anywhere.
See [PRIVACY.md](PRIVACY.md) for the full privacy policy and the reason for each permission.

## Development

The extension is plain JavaScript modules with no dependencies and no build step.

```text
extension/          the unpacked extension, and the content of the store zip
extension/lib/      modules shared by the pages and the service worker
tests/              Node tests, run with node --test
tests/browser/      a manual encoder check that runs in Chrome
tests/e2e/          smoke test that drives a real Chrome over the DevTools protocol
scripts/            check.mjs (syntax) and package.mjs (store zip)
images/             the README banner
```

Run the checks from the repository root. Node 22 or later is required.

```text
npm run check
npm test
npm run package
```

`npm run package` writes `dist/goatmeet-<version>.zip` with `manifest.json` at the archive root, ready for the Chrome Web Store.

Chrome APIs are not available in Node, so the tests load each page script into a `vm` context with fake `chrome`, `document`, and `navigator` objects.
`npm run e2e` starts a real Chrome with the extension and checks every page and the encoder.

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT. See [LICENSE](LICENSE).

## References

- [Chrome tab capture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- [Offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [File System Access and directory handles](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [MP4 recording support in Chrome 126](https://developer.chrome.com/release-notes/126)
- [MediaStream Recording specification](https://w3c.github.io/mediacapture-record/)
- [Google’s offscreen recording sample](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/sample.tabcapture-recorder)
