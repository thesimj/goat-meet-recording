import assert from "node:assert/strict";
import { test } from "node:test";
import { toolbarState } from "../extension/lib/toolbar.mjs";
import { runPage, settle } from "./helpers/page.mjs";

const RECORDER_URL = "chrome-extension://test/offscreen.html";

/**
 * Load background.js with a fake chrome namespace.
 * The fake records toolbar appearances, offscreen documents, and recorder commands.
 */
async function loadBackground({
  activeTab = { id: 1, url: "https://meet.google.com/abc-defg-hij", title: "Meet" },
  tabs = { 1: activeTab },
  settings = { includeMic: true, directory: { name: "goatmeet", queryPermission: async () => "granted" } },
  micGranted = true,
  recorderState = { phase: "idle" },
} = {}) {
  const log = { appearances: [], recorder: [], created: 0, streamIds: [] };
  const listeners = {};
  let recorderExists = false;
  const addListener = (name) => ({ addListener: (handler) => { listeners[name] = handler; } });
  const chrome = {
    runtime: {
      id: "test",
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => recorderExists ? [{ documentUrl: RECORDER_URL }] : [],
      onMessage: addListener("onMessage"),
      onInstalled: addListener("onInstalled"),
      onStartup: addListener("onStartup"),
    },
    offscreen: { createDocument: async () => { recorderExists = true; log.created++; } },
    tabs: {
      query: async () => (activeTab ? [activeTab] : []),
      get: async (id) => {
        if (!tabs[id]) throw new Error(`No tab with id: ${id}.`);
        return tabs[id];
      },
      onActivated: addListener("onActivated"),
      onUpdated: addListener("onUpdated"),
    },
    windows: { onFocusChanged: addListener("onFocusChanged") },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => { log.streamIds.push(targetTabId); return `stream-${targetTabId}`; } },
  };
  const globals = {
    chrome,
    console: { error(error) { log.error = error; } },
    loadSettings: async () => settings,
    microphoneGranted: async () => micGranted,
    toolbarState,
    setToolbar: async (appearance) => { log.appearances.push(appearance); },
    recorderCommand: async (type, data) => {
      log.recorder.push({ type, ...data });
      if (type === "start") return { phase: "recording", tabId: data.tabId };
      return recorderState;
    },
  };
  await runPage("background.js", globals);
  await settle();

  /** Send a message from a page of this extension and return the reply. */
  function message(body, sender = { id: "test", url: "chrome-extension://test/popup.html" }) {
    return new Promise((resolve) => {
      const keepOpen = listeners.onMessage({ target: "controller", ...body }, sender, resolve);
      if (keepOpen !== true) resolve(undefined);
    });
  }
  return { log, listeners, message, setRecorder: (exists) => { recorderExists = exists; } };
}

test("startup draws a ready toolbar and status reports idle without an offscreen document", async () => {
  const { log, message } = await loadBackground();
  assert.equal(log.appearances.at(-1).phase, "ready");
  const reply = await message({ type: "status" });
  assert.equal(reply.ok, true);
  assert.equal(reply.state.phase, "idle");
  assert.deepEqual(log.recorder, [], "no recorder command while no offscreen document exists");
});

test("missing folder or microphone access shows the amber badge", async () => {
  const noFolder = await loadBackground({ settings: { includeMic: true }, micGranted: false });
  assert.equal(noFolder.log.appearances.at(-1).phase, "permission");
  assert.match(noFolder.log.appearances.at(-1).title, /Folder access needed\. Microphone access needed/);

  const noMic = await loadBackground({ micGranted: false });
  assert.match(noMic.log.appearances.at(-1).title, /^GoatMeet - Microphone access needed/);
});

test("a selected folder is treated as ready even when its permission query says prompt", async () => {
  // The service worker cannot confirm a directory handle's permission (that is window-scoped),
  // so it must judge the folder by whether one is selected, not by queryPermission. Otherwise the
  // amber badge sticks forever after access is granted in the popup.
  const settings = {
    includeMic: true,
    directory: { name: "goatmeet", queryPermission: async () => "prompt" },
  };
  const { log } = await loadBackground({ settings, micGranted: true });
  assert.equal(log.appearances.at(-1).phase, "ready");
  assert.doesNotMatch(log.appearances.at(-1).title, /Folder access needed/);
});

test("a tab whose URL Chrome withholds is treated as a web page, not as unsupported", async () => {
  const { log } = await loadBackground({ activeTab: { id: 5 } });
  assert.equal(log.appearances.at(-1).phase, "ready");
  const chromePage = await loadBackground({ activeTab: { id: 5, url: "chrome://extensions" } });
  assert.equal(chromePage.log.appearances.at(-1).phase, "unsupported");
});

test("start validates the tab, creates the recorder once, and forwards the stream id", async () => {
  const { log, message } = await loadBackground();
  assert.deepEqual(await message({ type: "start" }), { ok: false, error: "Select a tab to record first." });
  assert.deepEqual(await message({ type: "start", tabId: 99 }), { ok: false, error: "No tab with id: 99." });

  const reply = await message({ type: "start", tabId: 1 });
  assert.equal(reply.ok, true);
  assert.equal(reply.state.phase, "recording");
  assert.equal(log.created, 1);
  assert.deepEqual(log.streamIds, [1]);
  assert.deepEqual(log.recorder.at(-1), {
    type: "start", streamId: "stream-1", tabId: 1, title: "Meet", meetingUrl: "https://meet.google.com/abc-defg-hij",
  });

  await message({ type: "stop" });
  assert.equal(log.recorder.at(-1).type, "stop");
  assert.equal(log.created, 1, "the existing offscreen document is reused");
});

test("start refuses non-web tabs, hidden URLs, and a second concurrent recording", async () => {
  const tabs = { 2: { id: 2, url: "chrome://settings" }, 3: { id: 3 }, 4: { id: 4, url: "https://zoom.us/j/1" } };
  const { message, setRecorder } = await loadBackground({ tabs, recorderState: { phase: "recording" } });
  assert.match((await message({ type: "start", tabId: 2 })).error, /the tab you want to record/);
  assert.match((await message({ type: "start", tabId: 3 })).error, /cannot see this tab/);
  setRecorder(true);
  assert.match((await message({ type: "start", tabId: 4 })).error, /already active/);
});

test("stop and mute without a recorder fail, and unknown commands are rejected", async () => {
  const { message } = await loadBackground();
  assert.deepEqual(await message({ type: "stop" }), { ok: false, error: "There is no active recording." });
  assert.deepEqual(await message({ type: "mute" }), { ok: false, error: "There is no active recording." });
  assert.deepEqual(await message({ type: "dance" }), { ok: false, error: "Unknown GoatMeet command." });
});

test("messages from other extensions or other targets are ignored", async () => {
  const { message, log } = await loadBackground();
  assert.equal(await message({ type: "status" }, { id: "someone-else" }), undefined);
  assert.equal(await message({ target: "recorder", type: "status" }), undefined);
  assert.deepEqual(log.recorder, []);
});

test("recorder updates and tab events redraw the toolbar, and refresh-toolbar replies", async () => {
  const { log, listeners, message, setRecorder } = await loadBackground({ recorderState: { phase: "recording", startedAt: Date.now(), title: "Meet" } });
  const before = log.appearances.length;
  setRecorder(true);
  await message({ type: "update", state: {} }, { id: "test", url: RECORDER_URL });
  await settle();
  assert.equal(log.appearances.at(-1).phase, "recording");
  assert.ok(log.appearances.length > before);

  listeners.onActivated({ tabId: 1 });
  listeners.onUpdated(1, { status: "complete" }, { active: true });
  listeners.onUpdated(1, { status: "loading" }, { active: true });
  listeners.onFocusChanged(2);
  await settle();
  assert.equal(log.appearances.length, before + 4);

  const reply = await message({ type: "refresh-toolbar" });
  assert.equal(reply.ok, true);
});
