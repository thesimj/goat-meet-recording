import assert from "node:assert/strict";
import { test } from "node:test";
import { stopStreams } from "../extension/lib/recording.mjs";
import { elementsOf, fakeDocument, runPage } from "./helpers/page.mjs";

class FakeOption {
  constructor(text, value) { this.text = text; this.value = value; }
}

/** A <select> double with the subset of behavior setup.mjs relies on. */
function fakeSelect(element) {
  element.options = [];
  element.replaceChildren = (...options) => { element.options = options; element.value = options[0]?.value ?? ""; };
  element.add = (option) => { element.options.push(option); };
  Object.defineProperty(element, "selectedIndex", {
    get: () => element.options.findIndex((option) => option.value === element.value),
  });
  return element;
}

async function loadSetup({ settings, folderPermission = "granted", micPermission = "granted", devices = [] } = {}) {
  const ui = await elementsOf("setup.html");
  fakeSelect(ui.microphone);
  const events = [];
  const pickerResult = { name: "Videos", getDirectoryHandle: async (name) => ({ name, queryPermission: async () => folderPermission }) };
  const globals = {
    document: fakeDocument(ui),
    Option: FakeOption,
    window: { showDirectoryPicker: async () => { events.push("picker"); if (pickerResult.cancel) throw Object.assign(new Error("x"), { name: "AbortError" }); return pickerResult; } },
    navigator: {
      permissions: { query: async () => ({ state: micPermission }) },
      mediaDevices: {
        enumerateDevices: async () => devices,
        getUserMedia: async () => { events.push("microphone"); return { getTracks: () => [{ stop() { events.push("release"); } }] }; },
      },
    },
    loadSettings: async () => settings,
    saveSettings: async (saved) => { events.push(`save:${saved.folderLabel || ""}:${saved.includeMic}:${saved.deviceId}:${saved.folderPath || ""}`); },
    recordingFilename: () => "20260917-1132-chrome-meeting.mp4",
    notify() {},
    stopStreams,
  };
  await runPage("setup.mjs", globals);
  return { ui, events, pickerResult };
}

test("a fresh install shows the default folder and asks for access", async () => {
  const { ui } = await loadSetup({ settings: { includeMic: true, deviceId: "" }, micPermission: "prompt" });
  assert.equal(ui.folder.textContent, "Default: Videos / goatmeet");
  assert.match(ui.status.textContent, /Choose a recording folder/);
  assert.equal(ui["allow-folder"].hidden, true);
  assert.equal(ui["folder-path"].disabled, true);
  assert.equal(ui.filename.textContent, "20260917-1132-chrome-meeting.mp4");
});

test("the default folder button records into a goatmeet subfolder and saves", async () => {
  const settings = { includeMic: true, deviceId: "" };
  const { ui, events } = await loadSetup({ settings });
  await ui["default-folder"].click();
  assert.equal(settings.directory.name, "goatmeet");
  assert.equal(settings.folderLabel, "Videos / goatmeet");
  assert.deepEqual(events, ["picker", "save:Videos / goatmeet:true::"]);
  assert.equal(ui.folder.textContent, "Folder: Videos / goatmeet");
  assert.match(ui.status.textContent, /^Ready\./);
  assert.equal(ui["folder-path"].disabled, false);
});

test("a custom folder is used directly and a stale display path is cleared", async () => {
  const settings = { includeMic: true, deviceId: "", folderPath: "D:\\old" };
  const { ui, events } = await loadSetup({ settings });
  await ui["custom-folder"].click();
  assert.equal(settings.directory.name, "Videos");
  assert.equal(settings.folderLabel, "Videos");
  assert.equal(settings.folderPath, "");
  assert.equal(events.at(-1), "save:Videos:true::");
  assert.match(ui["video-path"].textContent, /Enter the full folder path/);
});

test("cancelling the picker keeps settings and is not shown as an error", async () => {
  const settings = { includeMic: true, deviceId: "" };
  const { ui, events, pickerResult } = await loadSetup({ settings });
  pickerResult.cancel = true;
  await ui["default-folder"].click();
  assert.deepEqual(events, ["picker"]);
  assert.equal(settings.directory, undefined);
  assert.match(ui.status.textContent, /Cancelled/);
  assert.equal(ui.status.classList.contains("error"), false);
});

test("the display-only path previews a full video path with the matching separator", async () => {
  const directory = { name: "goatmeet", queryPermission: async () => "granted" };
  const settings = { includeMic: false, deviceId: "", directory, folderLabel: "Videos / goatmeet" };
  const { ui, events } = await loadSetup({ settings });
  ui["folder-path"].value = " C:\\Users\\me\\Videos\\goatmeet\\ ";
  await ui["folder-path"].change();
  assert.equal(settings.folderPath, "C:\\Users\\me\\Videos\\goatmeet\\");
  assert.match(ui["video-path"].textContent, /C:\\Users\\me\\Videos\\goatmeet\\20260917-1132-chrome-meeting\.mp4$/);
  ui["folder-path"].value = "/home/me/Videos/goatmeet";
  await ui["folder-path"].change();
  assert.match(ui["video-path"].textContent, /\/home\/me\/Videos\/goatmeet\/20260917-1132-chrome-meeting\.mp4$/);
  assert.equal(events.length, 2);
});

test("turning the microphone off saves and reports readiness without microphone access", async () => {
  const directory = { name: "goatmeet", queryPermission: async () => "granted" };
  const settings = { includeMic: true, deviceId: "", directory };
  const { ui, events } = await loadSetup({ settings, micPermission: "prompt" });
  assert.match(ui.status.textContent, /Allow microphone access/);
  ui["include-mic"].checked = false;
  await ui["include-mic"].change();
  assert.equal(settings.includeMic, false);
  assert.equal(events.at(-1), "save::false::");
  assert.match(ui.status.textContent, /^Ready\./);
  assert.equal(ui.microphone.disabled, true);
});

test("allowing the microphone lists devices and keeps an unavailable saved choice visible", async () => {
  const directory = { name: "goatmeet", queryPermission: async () => "granted" };
  const settings = { includeMic: true, deviceId: "gone", directory };
  const devices = [
    { kind: "audioinput", deviceId: "default", label: "Default" },
    { kind: "audioinput", deviceId: "usb", label: "USB Mic" },
    { kind: "videoinput", deviceId: "cam", label: "Camera" },
  ];
  const { ui, events } = await loadSetup({ settings, micPermission: "prompt", devices });
  assert.equal(ui.microphone.options.length, 0, "no device list before access");
  await ui["allow-mic"].click();
  assert.deepEqual(events.slice(0, 2), ["microphone", "release"]);
  assert.deepEqual(ui.microphone.options.map((option) => option.text), ["System default", "USB Mic", "Previously selected microphone (unavailable)"]);
  assert.equal(ui.microphone.value, "gone");

  ui.microphone.value = "usb";
  await ui.microphone.change();
  assert.equal(settings.deviceId, "usb");
  assert.equal(events.at(-1), "save::true:usb:");
});

test("a stored folder without permission shows the allow button and hides it once granted", async () => {
  let permission = "prompt";
  const directory = {
    name: "goatmeet",
    queryPermission: async () => permission,
    requestPermission: async () => { permission = "granted"; return permission; },
  };
  const settings = { includeMic: false, deviceId: "", directory };
  const { ui } = await loadSetup({ settings });
  assert.equal(ui["allow-folder"].hidden, false);
  await ui["allow-folder"].click();
  assert.equal(ui["allow-folder"].hidden, true);
  assert.match(ui.status.textContent, /^Ready\./);
});
