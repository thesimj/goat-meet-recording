import assert from "node:assert/strict";
import { test } from "node:test";
import { meetingDetails, newRecordingFile, recordingFilename } from "../extension/lib/filenames.mjs";

test("filenames use the requested format and local calendar time", () => {
  assert.equal(recordingFilename(new Date(2026, 8, 17, 11, 32)), "20260917-1132-chrome-meeting.mp4");
  assert.equal(recordingFilename(new Date(2026, 0, 2, 3, 4)), "20260102-0304-chrome-meeting.mp4");
});

test("meeting filenames extract supported path IDs without query passcodes", () => {
  const cases = [
    ["https://meet.google.com/jac-mxgd-uap?authuser=1", "google-meet", "jac-mxgd-uap"],
    ["https://us02web.zoom.us/j/12345678901?pwd=secret", "zoom", "12345678901"],
    ["https://app.zoom.us/wc/12345678901/join?pwd=secret", "zoom", "12345678901"],
    ["https://zoom.us/wc/join/12345678901", "zoom", "12345678901"],
    ["https://zoom.us/my/weekly.meeting?pwd=secret", "zoom", "weekly.meeting"],
    ["https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC123%40thread.v2/0?context=secret", "microsoft-teams", "ABC123"],
    ["https://teams.cloud.microsoft/meet/1234567890123?p=secret", "microsoft-teams", "1234567890123"],
    ["https://teams.live.com/meet/1234567890123?p=secret", "microsoft-teams", "1234567890123"],
    ["https://meet.google.com/landing", "google-meet", ""],
    ["https://zoom.us/join?pwd=secret", "zoom", ""],
    ["https://zoom.us.example.com/j/12345678901", "chrome-meeting", ""],
    ["https://teams.microsoft.com/l/meetup-join/%xx", "chrome-meeting", ""],
    ["ftp://meet.google.com/jac-mxgd-uap", "chrome-meeting", ""],
    ["not a URL", "chrome-meeting", ""],
    ["", "chrome-meeting", ""],
  ];
  for (const [url, provider, slug] of cases) {
    assert.deepEqual(meetingDetails(url), { provider, slug }, url);
  }
});

test("recognized services and fallbacks build the expected filenames", () => {
  const date = new Date(2026, 8, 17, 11, 32);
  assert.equal(recordingFilename(date, "https://meet.google.com/jac-mxgd-uap"), "20260917-1132-google-meet-jac-mxgd-uap.mp4");
  assert.equal(recordingFilename(date, "https://zoom.us/j/12345678901?pwd=secret"), "20260917-1132-zoom-12345678901.mp4");
  assert.equal(recordingFilename(date, "https://teams.microsoft.com/meet/1234567890123?p=secret"), "20260917-1132-microsoft-teams-1234567890123.mp4");
  assert.equal(recordingFilename(date, "https://unknown.example/secret?token=secret"), "20260917-1132-chrome-meeting.mp4");
  assert.equal(recordingFilename(date, "https://meet.google.com/landing"), "20260917-1132-google-meet.mp4");
});

test("unsafe slugs are sanitized and capped", () => {
  const hostile = encodeURIComponent("../a:b?c\\d" + "x".repeat(200));
  const name = recordingFilename(new Date(), `https://teams.microsoft.com/meet/${hostile}`);
  assert.doesNotMatch(name, /[\\/:?]/);
  assert.ok(name.length < 130, name.length);
  assert.match(name, /-microsoft-teams-a-b-c-dx+\.mp4$/);
});

test("a repeated minute never overwrites an existing recording", async () => {
  const existing = new Set(["20260917-1132-chrome-meeting.mp4", "20260917-1132-chrome-meeting-2.mp4"]);
  const directory = {
    async getFileHandle(name, options) {
      if (existing.has(name)) return { name };
      if (!options?.create) throw new DOMException("Missing", "NotFoundError");
      existing.add(name);
      return { name };
    },
  };
  const date = new Date(2026, 8, 17, 11, 32);
  assert.equal((await newRecordingFile(directory, date)).name, "20260917-1132-chrome-meeting-3.mp4");
  assert.equal((await newRecordingFile(directory, date, "https://meet.google.com/jac-mxgd-uap")).name, "20260917-1132-google-meet-jac-mxgd-uap.mp4");
  assert.equal((await newRecordingFile(directory, date, "https://meet.google.com/jac-mxgd-uap")).name, "20260917-1132-google-meet-jac-mxgd-uap-2.mp4");
});

test("a folder that holds the name is skipped, and other errors stop the search", async () => {
  const directory = {
    async getFileHandle(name, options) {
      if (name.endsWith("-chrome-meeting.mp4")) throw new DOMException("Folder", "TypeMismatchError");
      if (!options?.create) throw new DOMException("Missing", "NotFoundError");
      return { name };
    },
  };
  assert.equal((await newRecordingFile(directory, new Date(2026, 8, 17, 11, 32))).name, "20260917-1132-chrome-meeting-2.mp4");
  await assert.rejects(newRecordingFile({ async getFileHandle() { throw new Error("permission denied"); } }), /permission denied/);
});
