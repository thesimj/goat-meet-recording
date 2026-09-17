# Security policy

## Supported versions

Only the latest release on the Chrome Web Store and the `main` branch receive fixes.

## Reporting a vulnerability

Use GitHub’s private vulnerability reporting for this repository:
<https://github.com/thesimj/goat-meet-recording/security/advisories/new>

Include the Chrome version, the operating system, and steps to reproduce.
Do not open a public issue for a security problem until a fix is released.

You will receive an acknowledgement within seven days.

## Scope

GoatMeet runs entirely on your computer and makes no network requests.
Problems worth reporting include:

- A way for a web page to start, stop, or read a recording.
- A recording written outside the folder the user selected.
- A filename that escapes the recording folder or contains data from the query string.
- A message from another extension that GoatMeet accepts as its own.
- A code path that reports a saved file after a failed write.

Recording without participant consent is a legal question for the user, not a vulnerability in the extension.
