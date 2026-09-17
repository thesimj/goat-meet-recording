// Service worker: routes popup commands to the offscreen recorder and keeps the toolbar current.
// It holds no recording state of its own, so Chrome may suspend it during a recording.
import { recorderCommand, reply } from "./lib/messaging.mjs";
import { isActivePhase, isRecordablePage, microphoneGranted, TARGET } from "./lib/shared.mjs";
import { loadSettings } from "./lib/storage.mjs";
import { setToolbar, toolbarState } from "./lib/toolbar.mjs";

const RECORDER_URL = chrome.runtime.getURL("offscreen.html");
const IDLE = Object.freeze({ phase: "idle" });

/** Start, stop, and mute run one at a time. */
let commands = Promise.resolve();
/** Toolbar redraws run one at a time, in order. */
let toolbarUpdates = Promise.resolve();

async function hasRecorder() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [RECORDER_URL],
  });
  return contexts.length > 0;
}

async function recorderState() {
  return (await hasRecorder()) ? recorderCommand("status") : IDLE;
}

async function ensureRecorder() {
  if (await hasRecorder()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Record the selected tab and microphone after the popup closes.",
  });
}

/**
 * Describe the active tab for the toolbar.
 * GoatMeet does not hold the "tabs" permission. Chrome shares a tab URL only after the
 * user clicks the toolbar icon on that tab (activeTab). Until then the URL is unknown and
 * the toolbar assumes a normal web page.
 */
async function activeTabAvailability() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const supported = tab?.url ? isRecordablePage(tab.url) : undefined;
  if (supported === false) return { supported };

  const settings = await loadSettings();
  const missing = [];
  // Judge the folder by whether one is selected, not by queryPermission. A directory handle's
  // read-write permission is tracked per window, so the service worker sees "prompt" even when a
  // window granted it. The popup, which runs in a window, does the real check before recording.
  if (!settings.directory) missing.push("Folder access needed");
  if (settings.includeMic && !(await microphoneGranted())) missing.push("Microphone access needed");
  return { supported, missing: missing.join(". ") };
}

/**
 * Redraw the toolbar. The recorder's own "update" messages carry its state, which saves a
 * round trip; every other trigger asks the recorder.
 */
function refreshToolbar(knownState) {
  toolbarUpdates = toolbarUpdates
    .then(async () => {
      const state = typeof knownState?.phase === "string" ? knownState : await recorderState();
      const busy = isActivePhase(state.phase) || state.phase === "error";
      const availability = busy ? {} : await activeTabAvailability();
      await setToolbar(toolbarState(state, availability));
    })
    .catch(console.error);
  return toolbarUpdates;
}

async function startRecording(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("Select a tab to record first.");
  const tab = await chrome.tabs.get(tabId);
  if (tab.url === undefined) {
    throw new Error("GoatMeet cannot see this tab. Click the GoatMeet icon on the tab you want to record, then press Start recording.");
  }
  if (!isRecordablePage(tab.url)) throw new Error("Open GoatMeet on the tab you want to record.");

  await ensureRecorder();
  const state = await recorderCommand("status");
  if (isActivePhase(state.phase)) throw new Error("A recording is already active. Stop it first.");

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  return recorderCommand("start", {
    streamId,
    tabId: tab.id,
    title: tab.title || "Meeting tab",
    meetingUrl: tab.url,
  });
}

async function handleCommand(message) {
  if (message.type === "start") return startRecording(message.tabId);
  if (message.type === "stop" || message.type === "mute") {
    if (!(await hasRecorder())) throw new Error("There is no active recording.");
    return recorderCommand(message.type);
  }
  throw new Error("Unknown GoatMeet command.");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== TARGET.controller) return;

  if (message.type === "refresh-toolbar") return reply(refreshToolbar(), respond);
  if (message.type === "update" && sender.url === RECORDER_URL) {
    refreshToolbar(message.state);
    return;
  }
  if (message.type === "status") return reply(recorderState(), respond);

  const operation = commands.then(() => handleCommand(message));
  commands = operation.catch(() => {});
  return reply(operation, respond);
});

// Event payloads are not recorder states, so every listener calls refreshToolbar without them.
chrome.tabs.onActivated.addListener(() => refreshToolbar());
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (tab.active && (change.url || change.status === "complete")) refreshToolbar();
});
chrome.windows.onFocusChanged.addListener(() => refreshToolbar());
chrome.runtime.onInstalled.addListener(() => refreshToolbar());
chrome.runtime.onStartup.addListener(() => refreshToolbar());
refreshToolbar();
