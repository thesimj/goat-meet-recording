# GoatMeet privacy policy

Last updated: 2026-09-17

GoatMeet is a Chrome extension that records a browser tab and your microphone to a video file on your own computer.
This policy explains what data the extension handles and where that data goes.

## Summary

- GoatMeet sends no data to anyone. It has no server and makes no network requests.
- Recordings are written only to the folder you select on your computer.
- Settings are stored only inside Chrome on your computer.
- GoatMeet contains no analytics, no telemetry, no advertising, and no third-party code.

## Data the extension handles

**Audio and video of the captured tab.** When you press Start recording, Chrome gives GoatMeet the video and audio of the tab you chose. GoatMeet encodes it and writes it to your chosen folder. It keeps nothing after the file is closed.

**Your microphone.** If “Include my microphone” is enabled, GoatMeet mixes your microphone into the same file. You can mute the recording microphone at any time from the popup, or disable the microphone in settings.

**The meeting tab’s address and title.** GoatMeet reads the address once, when recording starts, to name the file, for example `20260917-1132-google-meet-jac-mxgd-uap.mp4`. It ignores query parameters, so passcodes never reach the filename. The title appears in the popup and in the toolbar tooltip while recording. Neither value is stored after the recording ends.

**Settings.** GoatMeet stores your folder choice, whether the microphone is included, the chosen microphone id, and an optional display-only folder path that you type yourself. These live in the extension’s IndexedDB database inside your Chrome profile. Uninstalling the extension deletes them.

## Where data goes

Recordings go to the folder you selected through Chrome’s folder picker. Nothing else receives them.

The extension’s Content Security Policy sets `connect-src 'none'`. Chrome enforces this and blocks any network request from the extension’s pages and service worker.

## Data GoatMeet does not collect

GoatMeet does not collect names, email addresses, account identifiers, browsing history, page content outside the captured tab, or usage statistics. It does not read cookies. It does not run code fetched from the internet.

## Permissions and why they are needed

| Permission | Why |
| --- | --- |
| `activeTab` | Read the address and title of the tab you clicked the GoatMeet icon on, so the popup can validate and name the recording. |
| `tabCapture` | Receive the video and audio of that tab after you press Start recording. |
| `offscreen` | Run the encoder and file writer in a hidden document that survives closing the popup. |
| Microphone | Requested through Chrome’s standard prompt, only when “Include my microphone” is enabled. |
| Folder access | Requested through Chrome’s folder picker when you press **Start recording** without prior access, through the access tab it opens. Chrome may ask you to confirm access again after a restart. |

GoatMeet does not request the `tabs` permission, host permissions, `storage`, or any other permission.

## Limited use

GoatMeet uses the data above only to produce the recording you asked for. It does not transfer data to any party, does not use it for advertising, and does not allow any person other than you to access it.

## Your responsibilities

Recording conversations is regulated in many jurisdictions and may require the consent of every participant. GoatMeet does not notify participants. You are responsible for obtaining consent where the law requires it.

## Changes

Changes to this policy are published in this repository. The date at the top shows the last revision. Each release notes policy changes in [CHANGELOG.md](CHANGELOG.md).

## Contact

Open an issue at <https://github.com/thesimj/goat-meet-recording/issues>.
