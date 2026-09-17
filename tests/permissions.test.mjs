import assert from "node:assert/strict";
import { test } from "node:test";
import { stopStreams } from "../extension/lib/recording.mjs";
import { elementsOf, fakeDocument, runPage } from "./helpers/page.mjs";

async function accessFlow({
  existing = true, folderAllowed = true, micAllowed = true, includeMic = true, cancel = false, recordingFails = false,
} = {}) {
  const ui = await elementsOf("permissions.html");
  const events = [];
  const directory = {
    name: "goatmeet",
    async requestPermission() {
      events.push("folder");
      return folderAllowed ? "granted" : "denied";
    },
  };
  const settings = { includeMic, ...(existing ? { directory } : {}) };
  const globals = {
    document: fakeDocument(ui),
    URLSearchParams,
    location: { search: "?tabId=42" },
    loadSettings: async () => settings,
    saveSettings: async () => { events.push("save"); },
    window: {
      close() { events.push("close"); },
      showDirectoryPicker: async (options) => {
        events.push("picker");
        assert.equal(options.startIn, "videos");
        assert.equal(options.mode, "readwrite");
        if (cancel) throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
        return {
          name: "Videos",
          getDirectoryHandle: async (name, handleOptions) => {
            assert.equal(name, "goatmeet");
            assert.equal(handleOptions.create, true);
            return directory;
          },
        };
      },
    },
    navigator: {
      permissions: { query: async () => ({ state: "prompt" }) },
      mediaDevices: {
        getUserMedia: async (constraints) => {
          events.push("microphone");
          assert.equal(constraints.audio, true);
          assert.equal(constraints.video, false);
          if (!micAllowed) throw Object.assign(new Error("Permission dismissed"), { name: "NotAllowedError" });
          return { getTracks: () => [{ stop() { events.push("release"); } }] };
        },
      },
    },
    chrome: {
      runtime: { getURL: () => "chrome-extension://test/" },
      tabs: {
        create() {},
        getCurrent: async () => ({ id: 7 }),
        remove: async (id) => { events.push(id === 7 ? "close" : `close-wrong:${id}`); },
      },
    },
    controllerCommand: async (type, data) => {
      assert.equal(type, "start");
      assert.equal(data.tabId, 42);
      events.push("record");
      if (recordingFails) throw new Error("Recording source disconnected.");
      return { phase: "recording" };
    },
    notify: (_target, type) => { events.push(type); },
    stopStreams,
  };
  await runPage("permissions.mjs", globals);
  assert.deepEqual(events, []);
  assert.equal(ui.allow.disabled, false);
  await ui.allow.click();
  return { ui, settings, events };
}

test("one access flow approves both permissions before starting the original meeting tab", async () => {
  const { events } = await accessFlow();
  assert.deepEqual(events, ["folder", "save", "microphone", "release", "refresh-toolbar", "record", "close"]);
});

test("first start creates and remembers goatmeet inside the chosen Videos folder", async () => {
  const { events, settings } = await accessFlow({ existing: false });
  assert.equal(settings.folderLabel, "Videos / goatmeet");
  assert.equal(settings.folderPath, "");
  assert.deepEqual(events, ["picker", "save", "microphone", "release", "refresh-toolbar", "record", "close"]);
});

test("denied folder access or cancelled selection never starts recording", async () => {
  const denied = await accessFlow({ folderAllowed: false });
  assert.deepEqual(denied.events, ["folder"]);
  assert.equal(denied.ui.allow.disabled, false);
  assert.ok(denied.ui.status.classList.contains("error"));

  const cancelled = await accessFlow({ existing: false, cancel: true });
  assert.deepEqual(cancelled.events, ["picker"]);
  assert.match(cancelled.ui.status.textContent, /No recording started/);
});

test("denied microphone access never starts recording and offers permission settings", async () => {
  const { events, ui } = await accessFlow({ micAllowed: false });
  assert.deepEqual(events, ["folder", "save", "microphone"]);
  assert.equal(ui.permissions.hidden, false);
  assert.equal(ui.allow.disabled, false);
  assert.match(ui.status.textContent, /Chrome microphone settings/);
});

test("tab-only recording does not request microphone access", async () => {
  const { events } = await accessFlow({ includeMic: false });
  assert.deepEqual(events, ["folder", "save", "refresh-toolbar", "record", "close"]);
});

test("a failed recording start keeps the permission window open with the error", async () => {
  const { events, ui } = await accessFlow({ recordingFails: true });
  assert.equal(events.includes("close"), false);
  assert.match(ui.status.textContent, /Recording source disconnected/);
  assert.equal(ui.permissions.hidden, true);
  assert.equal(ui.allow.disabled, false);
});

test("a missing tab id disables the flow with guidance", async () => {
  const ui = await elementsOf("permissions.html");
  await runPage("permissions.mjs", {
    document: fakeDocument(ui),
    URLSearchParams,
    location: { search: "" },
    loadSettings: async () => ({ includeMic: true }),
    window: {},
    navigator: {},
    chrome: { runtime: { getURL: () => "" }, tabs: {} },
    controllerCommand() {},
    notify() {},
    stopStreams,
  });
  assert.equal(ui.allow.disabled, false, "the markup disables it; the script never enables it");
  assert.match(ui.status.textContent, /the tab you want to record/);
});
