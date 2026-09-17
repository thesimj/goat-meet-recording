// Access page: grant the missing folder and microphone access, then start the recording.
// It opens as its own tab because Chrome's folder picker needs a click inside a real page,
// which the toolbar popup cannot host without closing.
import { controllerCommand, notify } from "./lib/messaging.mjs";
import { stopStreams } from "./lib/recording.mjs";
import {
  describeFolder, FOLDER_PICKER_OPTIONS, microphoneGranted, pageElements, setStatus, TARGET, useRecordingFolder,
} from "./lib/shared.mjs";
import { loadSettings, saveSettings } from "./lib/storage.mjs";

const ui = pageElements(document);
const tabId = Number(new URLSearchParams(location.search).get("tabId"));

let settings;
let busy = false;

const showStatus = (message, options) => setStatus(ui.status, message, options);

/**
 * Close only this access window.
 * window.close() has been observed to quit the whole browser on some Chrome builds, so it is
 * never used. Remove this page's own tab by id, or as a fallback this page's own window by id.
 * Both target a specific id and cannot affect another tab or window. If neither id is available,
 * leave the window open and ask the user to close it rather than risk quitting Chrome.
 */
async function closeSelf() {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.remove(tab.id);
      return;
    }
  } catch { /* try the window next */ }
  try {
    const win = await chrome.windows.getCurrent();
    if (win?.id !== undefined) {
      await chrome.windows.remove(win.id);
      return;
    }
  } catch { /* fall through to the message */ }
  showStatus("Recording started. You can close this window.");
}

/** Request folder access first, while the click still counts as user activation. */
async function ensureFolder() {
  if (settings.directory) {
    showStatus("Allow access to your recording folder in Chrome's prompt.");
    const permission = await settings.directory.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      throw new Error("Folder access was not granted. Click Allow and record to try again.");
    }
    return;
  }
  showStatus("Select your Videos folder. GoatMeet will create a goatmeet subfolder.");
  const chosen = await window.showDirectoryPicker(FOLDER_PICKER_OPTIONS);
  await useRecordingFolder(settings, chosen, { subfolder: true });
}

/** Ask for the microphone once. The stream is released immediately. */
async function ensureMicrophone() {
  if (!settings.includeMic || (await microphoneGranted(navigator.permissions))) return;
  showStatus("Allow your microphone in Chrome's prompt.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  stopStreams(stream);
}

function describeFailure(stage, error) {
  if (error.name === "AbortError") return "Cancelled. No recording started.";
  if (stage === "microphone" && error.name === "NotAllowedError") {
    return "Chrome did not grant microphone access. Allow GoatMeet in Chrome microphone settings, then try again.";
  }
  return error.message;
}

async function allowAndRecord() {
  if (busy || !settings) return;
  busy = true;
  ui.allow.disabled = true;
  ui.permissions.hidden = true;
  ui.status.classList.remove("error");
  let stage = "folder";
  try {
    await ensureFolder();
    await saveSettings(settings);
    ui.folder.textContent = `Folder: ${describeFolder(settings)}`;

    stage = "microphone";
    await ensureMicrophone();

    stage = "recording";
    // The popup and toolbar recheck access on their own; nudge the toolbar to update at once.
    notify(TARGET.controller, "refresh-toolbar");
    showStatus("Starting the recording…");
    await controllerCommand("start", { tabId });
    await closeSelf();
  } catch (error) {
    showStatus(describeFailure(stage, error), { error: true });
    ui.permissions.hidden = !(stage === "microphone" && error.name === "NotAllowedError");
  } finally {
    busy = false;
    ui.allow.disabled = false;
  }
}

function openMicrophoneSettings() {
  const site = encodeURIComponent(chrome.runtime.getURL(""));
  chrome.tabs.create({ url: `chrome://settings/content/siteDetails?site=${site}` });
}

ui.allow.addEventListener("click", allowAndRecord);
ui.close.addEventListener("click", closeSelf);
ui.permissions.addEventListener("click", openMicrophoneSettings);

try {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error("Open GoatMeet on the tab you want to record and press Start recording.");
  }
  settings = await loadSettings();
  ui.folder.textContent = settings.directory
    ? `Folder: ${describeFolder(settings)}`
    : "Default: select Videos to create Videos / goatmeet.";
  ui.microphone.textContent = settings.includeMic ? "Microphone: include your voice" : "Microphone: off (tab audio only)";
  showStatus("Click Allow and record, then approve Chrome's access requests.");
  ui.allow.disabled = false;
} catch (error) {
  showStatus(error.message);
}
