import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeFolder, elapsedFor, folderGranted, formatElapsed, formatMegabytes, isActivePhase, isRecordablePage,
  microphoneGranted, missingAccess, useRecordingFolder,
} from "../extension/lib/shared.mjs";

test("only http and https pages are recordable", () => {
  assert.equal(isRecordablePage("https://meet.google.com/abc"), true);
  assert.equal(isRecordablePage("http://localhost:3000/"), true);
  assert.equal(isRecordablePage("chrome://extensions"), false);
  assert.equal(isRecordablePage("file:///C:/video.html"), false);
  assert.equal(isRecordablePage(undefined), false);
});

test("active phases are starting, recording, and stopping", () => {
  for (const phase of ["starting", "recording", "stopping"]) assert.equal(isActivePhase(phase), true);
  for (const phase of ["idle", "saved", "error", undefined]) assert.equal(isActivePhase(phase), false);
});

test("elapsed time formats as HH:MM:SS and never goes negative", () => {
  assert.equal(formatElapsed(0), "00:00:00");
  assert.equal(formatElapsed(65_000), "00:01:05");
  assert.equal(formatElapsed(3_599_999), "00:59:59");
  assert.equal(formatElapsed(36_000_000), "10:00:00");
  assert.equal(formatElapsed(-5000), "00:00:00");
});

test("elapsedFor freezes at endedAt and is zero before a start", () => {
  assert.equal(elapsedFor({ phase: "idle" }), 0);
  assert.equal(elapsedFor({ startedAt: 1000 }, 61_000), 60_000);
  assert.equal(elapsedFor({ startedAt: 1000, endedAt: 31_000 }, 999_999), 30_000);
});

test("sizes format in decimal megabytes with one decimal", () => {
  assert.equal(formatMegabytes(undefined), "0.0 MB");
  assert.equal(formatMegabytes(2_549_999), "2.5 MB");
  assert.equal(formatMegabytes(1_860_000_000), "1860.0 MB");
});

test("folder labels prefer the saved label over the handle name", () => {
  assert.equal(describeFolder({}), "");
  assert.equal(describeFolder({ directory: { name: "goatmeet" } }), "goatmeet");
  assert.equal(describeFolder({ directory: { name: "goatmeet" }, folderLabel: "Videos / goatmeet" }), "Videos / goatmeet");
});

test("useRecordingFolder creates the subfolder by default and clears the display path", async () => {
  const chosen = {
    name: "Videos",
    getDirectoryHandle: async (name, options) => ({ name, created: options.create }),
  };
  const settings = { folderPath: "C:\\stale" };
  await useRecordingFolder(settings, chosen);
  assert.deepEqual(settings, { directory: { name: "goatmeet", created: true }, folderLabel: "Videos / goatmeet", folderPath: "" });

  const direct = await useRecordingFolder({}, chosen, { subfolder: false });
  assert.equal(direct.directory, chosen);
  assert.equal(direct.folderLabel, "Videos");
});

test("access checks tolerate missing handles and permissions objects", async () => {
  assert.equal(await folderGranted(undefined), false);
  assert.equal(await folderGranted({ queryPermission: async ({ mode }) => (mode === "readwrite" ? "granted" : "denied") }), true);
  assert.equal(await microphoneGranted(undefined), false);
  assert.equal(await microphoneGranted({ query: async () => ({ state: "granted" }) }), true);
  assert.equal(await microphoneGranted({ query: async () => ({ state: "prompt" }) }), false);
});

test("missingAccess lists folder selection, folder access, and microphone access in order", async () => {
  const granted = { query: async () => ({ state: "granted" }) };
  const prompt = { query: async () => ({ state: "prompt" }) };
  assert.deepEqual(await missingAccess({ includeMic: true }, prompt), ["folder selection", "microphone access"]);
  const denied = { queryPermission: async () => "prompt" };
  assert.deepEqual(await missingAccess({ includeMic: false, directory: denied }, prompt), ["folder access"]);
  const ok = { queryPermission: async () => "granted" };
  assert.deepEqual(await missingAccess({ includeMic: true, directory: ok }, granted), []);
});
