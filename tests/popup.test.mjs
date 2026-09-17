import assert from "node:assert/strict";
import { test } from "node:test";
import { elementsOf, fakeDocument, runPage } from "./helpers/page.mjs";

async function loadPopup({ tab, settings, state, permissions }) {
  const ui = await elementsOf("popup.html");
  const opened = [];
  const commands = [];
  const globals = {
    document: fakeDocument(ui),
    chrome: {
      tabs: { query: async () => [tab], create: async (options) => opened.push(options) },
      runtime: { getURL: (path) => `chrome-extension://test/${path}`, openOptionsPage() {} },
    },
    navigator: { permissions },
    loadSettings: async () => settings,
    recordingFilename: () => "test.mp4",
    chooseMimeType() {},
    controllerCommand: async (type, data) => {
      commands.push({ type, ...data });
      return state.current;
    },
    notify() {},
    setInterval() {},
  };
  const { refresh } = await runPage("popup.mjs", globals, ["refresh"]);
  return { ui, opened, commands, refresh };
}

test("Start stays enabled for missing permissions and opens one access flow for the original tab", async () => {
  const settings = { includeMic: true };
  const tab = { id: 1, title: "Test meeting", url: "https://meet.google.com/test" };
  let folderPermission = "prompt";
  let micPermission = "prompt";
  const state = { current: { phase: "saved", message: "Saved an earlier recording." } };
  const permissions = { query: async () => ({ state: micPermission }) };

  const { ui, opened, refresh } = await loadPopup({ tab, settings, state, permissions });
  assert.equal(ui.start.disabled, false);
  assert.equal(ui.start.textContent, "Start recording", "the button label never changes");
  assert.match(ui.status.textContent, /^Press Start recording\./);
  assert.match(ui.status.textContent, /folder selection/);
  assert.match(ui.status.textContent, /microphone access/);
  assert.doesNotMatch(ui.status.textContent, /Saved an earlier/);
  assert.equal(opened.length, 0);

  await ui.start.click();
  assert.equal(opened[0].url, "chrome-extension://test/permissions.html?tabId=1");
  assert.equal(opened.length, 1, "the access page opens as a tab, not a popup window");

  settings.directory = { name: "goatmeet", queryPermission: async () => folderPermission };
  await refresh();
  assert.match(ui.status.textContent, /folder access/);
  folderPermission = "granted";
  await refresh();
  assert.equal(ui.start.disabled, false);
  assert.doesNotMatch(ui.status.textContent, /folder access/);
  assert.match(ui.start.title, /microphone access/);

  micPermission = "granted";
  await refresh();
  assert.equal(ui.start.disabled, false);
  assert.equal(ui.start.textContent, "Start recording");
  assert.equal(ui["mic-permission"].textContent, "Microphone: allowed");

  micPermission = "prompt";
  settings.includeMic = false;
  await refresh();
  assert.equal(ui.start.disabled, false);
  assert.match(ui["mic-permission"].textContent, /tab audio only/);

  tab.url = "chrome://extensions";
  await refresh();
  assert.equal(ui.start.disabled, true);
  assert.equal(ui.start.textContent, "Start recording", "the label is stable on a non-web tab");
  assert.match(ui.status.textContent, /web page tab/);

  state.current = { phase: "recording", tabId: 1, message: "Recording this tab." };
  await refresh();
  assert.equal(ui.stop.disabled, false);
  assert.equal(ui.start.hidden, true);
  assert.equal(ui.status.textContent, "Recording this tab.");
});

test("Start reads Start recording after a recording ends, even when access came from the window", async () => {
  // Reproduces the report: after Stop the button briefly showed "Allow access and record".
  const settings = { includeMic: true };
  const tab = { id: 4, title: "Meet", url: "https://meet.google.com/x" };
  let folderPermission = "prompt";
  let micPermission = "prompt";
  const state = { current: { phase: "idle" } };
  const permissions = { query: async () => ({ state: micPermission }) };
  const { ui, opened, refresh } = await loadPopup({ tab, settings, state, permissions });

  // Access is missing, so the first Start opens the access window.
  await ui.start.click();
  assert.equal(opened.length, 1);
  assert.equal(ui.start.textContent, "Start recording");

  // The window grants access and starts the recording out of band.
  settings.directory = { name: "goatmeet", queryPermission: async () => folderPermission };
  folderPermission = "granted";
  micPermission = "granted";
  state.current = { phase: "recording", tabId: 4, message: "Recording this tab." };
  await refresh();
  assert.equal(ui.start.hidden, true);

  // Stop the recording. The button must read the plain label, not the access label.
  state.current = { phase: "saved", savedAt: Date.now(), filename: "x.mp4", message: "Saved x.mp4." };
  await refresh();
  assert.equal(ui.start.hidden, false);
  assert.equal(ui.start.textContent, "Start recording");
  assert.equal(ui.start.disabled, false);
});

test("Start sends the command directly once access is granted, and stop and mute pass through", async () => {
  const settings = {
    includeMic: true,
    directory: { name: "goatmeet", queryPermission: async () => "granted" },
  };
  const tab = { id: 7, title: "Zoom", url: "https://zoom.us/j/123" };
  const state = { current: { phase: "idle" } };
  const permissions = { query: async () => ({ state: "granted" }) };

  const { ui, opened, commands, refresh } = await loadPopup({ tab, settings, state, permissions });
  assert.equal(ui.status.textContent, "Ready. Start recording this tab anytime.");
  assert.equal(ui.start.textContent, "Start recording");

  state.current = { phase: "recording", tabId: 7, includeMic: true, startedAt: Date.now() - 65_000, bytes: 2_500_000, message: "Recording this tab." };
  await ui.start.click();
  assert.deepEqual(commands.at(-1), { type: "start", tabId: 7 });
  assert.equal(opened.length, 0);
  assert.equal(ui.elapsed.textContent, "00:01:05");
  assert.equal(ui.size.textContent, "2.5 MB");
  assert.equal(ui.mute.hidden, false);
  assert.match(ui["mic-note"].textContent, /even if the page mutes it/);

  await ui.mute.click();
  assert.equal(commands.at(-1).type, "mute");
  await ui.stop.click();
  assert.equal(commands.at(-1).type, "stop");

  state.current = { phase: "recording", tabId: 3, title: "Other meeting", message: "Recording this tab." };
  await refresh();
  assert.match(ui.status.textContent, /Recording the original tab, not this tab/);
  assert.equal(ui.meeting.textContent, "Other meeting");
});

test("a missing MP4 encoder disables Start and explains why", async () => {
  const ui = await elementsOf("popup.html");
  await runPage("popup.mjs", {
    document: fakeDocument(ui),
    chrome: { tabs: { query: async () => [{ id: 1, url: "https://meet.google.com/x" }] }, runtime: {} },
    navigator: { permissions: { query: async () => ({ state: "granted" }) } },
    loadSettings: async () => ({ includeMic: true }),
    recordingFilename: () => "test.mp4",
    chooseMimeType() { throw new Error("This Chrome installation cannot record H.264 + AAC MP4."); },
    controllerCommand: async () => ({ phase: "idle" }),
    notify() {},
    setInterval() {},
  });
  assert.equal(ui.start.disabled, true);
  assert.match(ui.status.textContent, /cannot record H\.264/);
});
