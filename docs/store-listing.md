# Chrome Web Store listing draft

Everything the developer dashboard asks for, ready to paste. Review before each submission.

## Account

- One-time developer registration fee, paid once per account.
- The developer email cannot be changed later. Use one you will keep.
- Complete the trader or non-trader declaration the dashboard shows for EU users.
- Publish under the publisher name you want the public to see.

## Product details

**Name**

```text
GoatMeet
```

**Summary** (the manifest description, at most 132 characters)

```text
Record any tab and your microphone to a local H.264 MP4. No account, no server, no upload.
```

**Category**: Productivity → Communication, or Tools. Pick one and keep it across versions.

**Language**: English.

**Description**

```text
GoatMeet records one browser tab, its audio, and your microphone into an MP4 file on your own computer.

Use it with Google Meet, Microsoft Teams, Zoom's web client, or any other meeting website.

HOW IT WORKS
1. Open your meeting's browser tab and click the GoatMeet icon.
2. Press Start recording. The first time, allow folder and microphone access in one step.
3. Join the meeting. A red REC badge shows on the toolbar while recording.
4. Press Stop recording. Your MP4 is in Videos/goatmeet, or the folder you chose.

WHAT YOU GET
• H.264 video and AAC audio in a standard MP4. Plays everywhere.
• Tab audio and your microphone mixed into one track.
• Files named by date, time, and meeting id, for example 20260917-1132-google-meet-jac-mxgd-uap.mp4.
• The file is written while you record and committed every five minutes. A crash keeps most of the meeting.
• Mute your recording microphone from the popup without touching the meeting.

PRIVACY
GoatMeet has no server and makes no network requests. Recordings stay in the folder you select. Settings stay inside Chrome. There are no accounts, no analytics, and no third-party code. The source is open under the MIT license at github.com/thesimj/goat-meet-recording.

REQUIREMENTS
Google Chrome 126 or later on Windows or macOS. Linux builds of Chrome lack the H.264 encoder.

GoatMeet does not notify meeting participants. You are responsible for obtaining consent where the law requires it.

GoatMeet is not affiliated with Google, Microsoft, or Zoom.
```

## Graphic assets

| Asset | Size | Status |
| --- | --- | --- |
| Store icon | 128×128 PNG, in the zip | Done: `extension/icons/goat128.png` |
| Screenshots | 1 to 5, 1280×800 preferred | To do |
| Small promo tile | 440×280 | To do. Items without it rank lower. |
| Marquee promo tile | 1400×560 | Optional |

Screenshot plan:

1. The popup on a meeting tab in the READY state.
2. The combined access window.
3. The popup while recording, with elapsed time and the mute button.
4. The settings page.
5. The recorded MP4 open in a player, with the filename visible.

Do not show Google Meet, Teams, or Zoom logos. Use a neutral page or a mock meeting page.

## Privacy practices tab

**Single purpose description**

```text
Record the current browser tab and the user's microphone into a video file saved in a folder the user selects on their own computer.
```

**Permission justifications**

`activeTab`

```text
Reads the address and title of the tab the user clicked the GoatMeet icon on. The address is used once to validate that the tab is a web page and to name the recording file, for example with the Google Meet code. The title is shown in the popup while recording. No other tabs are read.
```

`tabCapture`

```text
Receives the video and audio stream of the tab the user chose after they press Start recording. This is the recording itself. Capture starts only from a user click and stops when the user presses Stop or closes the tab.
```

`offscreen`

```text
Runs the MediaRecorder encoder and the file writer in an offscreen document. Service workers cannot use getUserMedia or MediaRecorder, and the recording must continue after the popup closes.
```

**Remote code**: No. The extension loads no remote scripts, and its Content Security Policy sets `connect-src 'none'`.

**Data usage**

Check the types the extension handles, even though nothing leaves the device:

- Personal communications (the recorded meeting audio and video)
- Website content (the captured tab video)

Do not check: personally identifiable information, health, financial, authentication, location, web history, user activity.

Certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**

```text
https://github.com/thesimj/goat-meet-recording/blob/main/PRIVACY.md
```

A GitHub Pages URL is also acceptable if one is set up later.

## Distribution

- Visibility: Public.
- Regions: All.
- Pricing: Free.

## Upload checklist

1. Bump `version` in `extension/manifest.json` and `package.json`.
2. Update `CHANGELOG.md`.
3. Run `npm run check`, `npm test`, `npm run package`.
4. Upload `dist/goatmeet-<version>.zip`.
5. Confirm the privacy practices tab still matches `PRIVACY.md`.
6. Submit for review. Expect several days because of `tabCapture`.

## Known review risks

- `tabCapture` shows the install warning “Read and change all your data on all websites”. The justification above explains why it is unavoidable.
- The name contains “Meet”. The listing states that GoatMeet is not affiliated with Google. Do not use Google Meet branding in any asset.
- Reviewers may test the access flow. It must work with a fresh profile and no prior folder selection.
