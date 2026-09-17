import assert from "node:assert/strict";
import { test } from "node:test";
import { COLORS, drawGoat, toolbarState } from "../extension/lib/toolbar.mjs";

test("toolbar distinguishes ready, missing permissions, and unsupported tabs", () => {
  assert.equal(toolbarState({ phase: "idle" }, { supported: true }).phase, "ready");
  const missing = toolbarState({ phase: "idle" }, { supported: true, missing: "Microphone access needed" });
  assert.equal(missing.phase, "permission");
  assert.equal(missing.text, "!");
  assert.match(missing.title, /Microphone access needed/);
  assert.equal(toolbarState({ phase: "idle" }, { supported: false }).phase, "unsupported");
});

test("an unknown tab URL is treated as a normal page", () => {
  assert.equal(toolbarState({ phase: "idle" }, {}).phase, "ready");
  assert.equal(toolbarState({ phase: "idle" }, { supported: undefined, missing: "Folder access needed" }).phase, "permission");
});

test("recording and saving take priority over the active tab and missing permissions", () => {
  const unavailable = { supported: false, missing: "Folder access needed" };
  const recording = toolbarState({ phase: "recording", title: "Google Meet", startedAt: 1000, micMuted: true }, unavailable, 1_469_000);
  assert.equal(recording.text, "REC");
  assert.equal(recording.color, COLORS.recording);
  assert.match(recording.title, /Google Meet - 00:24:28 - recording mic muted/);
  assert.equal(toolbarState({ phase: "starting" }, unavailable).text, "…");
  assert.equal(toolbarState({ phase: "stopping" }, unavailable).text, "SAVE");
  assert.equal(toolbarState({ phase: "error", message: "Disk full" }, unavailable).text, "ERR");
});

test("saved checkmark expires after five seconds but save warnings remain visible", () => {
  const saved = { phase: "saved", savedAt: 1000, filename: "meeting.mp4" };
  assert.equal(toolbarState(saved, { supported: true }, 5999).text, "✓");
  assert.equal(toolbarState(saved, { supported: true }, 6000).phase, "ready");
  assert.equal(toolbarState(saved, { supported: false }, 6000).phase, "unsupported");
  const warning = toolbarState({ ...saved, warning: true, message: "Recording ended early" }, { supported: true }, 7000);
  assert.equal(warning.text, "!");
  assert.match(warning.title, /Recording ended early/);
});

test("every phase has a color and draws without errors on a recording canvas context", () => {
  const calls = [];
  const context = new Proxy({}, {
    get: (_target, name) => (...args) => { calls.push(name); return args; },
    set: () => true,
  });
  for (const phase of Object.keys(COLORS)) {
    calls.length = 0;
    drawGoat(context, 16, phase);
    assert.ok(calls.includes("roundRect"), phase);
    const hasDisc = ["recording", "saved", "error"].includes(phase);
    assert.equal(calls.includes("arc"), hasDisc, `${phase} status disc`);
  }
});
