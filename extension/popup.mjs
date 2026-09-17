// Toolbar popup: start, stop, and mute the recording of the active tab.
import { recordingFilename } from "./lib/filenames.mjs";
import { controllerCommand, notify } from "./lib/messaging.mjs";
import { chooseMimeType } from "./lib/recording.mjs";
import {
  describeFolder, elapsedFor, formatElapsed, formatMegabytes, isActivePhase, isRecordablePage,
  missingAccess, pageElements, TARGET,
} from "./lib/shared.mjs";
import { loadSettings } from "./lib/storage.mjs";

const ui = pageElements(document);

let tab;
let state = { phase: "idle" };
/** True when folder and microphone access are both granted. */
let configured = false;
/** True while a button action runs. */
let pending = false;
let refreshing = false;
/** Guidance about missing access, shown instead of the recorder message when idle. */
let setupMessage = "";
/** A problem that prevents any recording, such as a missing MP4 encoder. */
let setupError = "";
/** Why the last button press failed. Shown until the next press or a recorder phase change. */
let actionError = "";
let actionErrorPhase;
/** The last access summary sent to the toolbar, so idle polling does not redraw it every second. */
let lastToolbarSummary;

const MIC_NOTES = {
  idle: "Your microphone records on its own, separate from the page’s mute controls.",
  recording: "Your microphone is recording, even if the page mutes it.",
  muted: "Your recording microphone is muted.",
  off: "Recording tab audio only. Your microphone is off.",
};

function micNote() {
  if (state.phase !== "recording") return MIC_NOTES.idle;
  if (!state.includeMic) return MIC_NOTES.off;
  return state.micMuted ? MIC_NOTES.muted : MIC_NOTES.recording;
}

function renderButtons(active) {
  const recordable = isRecordablePage(tab?.url);
  ui.start.hidden = active;
  ui.start.disabled = pending || Boolean(setupError) || !recordable;
  ui.start.title = pending ? "Please wait for the current action." : setupMessage;
  ui.stop.hidden = !active;
  ui.stop.disabled = pending || state.phase !== "recording";
  ui.mute.hidden = state.phase !== "recording" || !state.includeMic;
  ui.mute.disabled = pending;
  // The mute control is an icon, so label it for assistive tech rather than replacing the icon.
  const muteLabel = state.micMuted ? "Unmute recording mic" : "Mute recording mic";
  ui.mute.setAttribute("aria-pressed", String(Boolean(state.micMuted)));
  ui.mute.setAttribute("aria-label", muteLabel);
  ui.mute.title = muteLabel;
  ui.mute.classList.toggle("muted", Boolean(state.micMuted));
}

function renderStatus(active) {
  let text = actionError || (!active && setupMessage) || state.message || "Ready. Start recording this tab anytime.";
  if (active && state.tabId !== tab?.id) text += " Recording the original tab, not this tab.";
  ui.status.textContent = text;
  ui.status.classList.toggle("error", state.phase === "error" || Boolean(actionError));
}

function renderDetails(active) {
  ui["mic-permission"].hidden = active;
  ui.elapsed.textContent = formatElapsed(elapsedFor(state));
  ui.size.textContent = formatMegabytes(state.bytes);
  ui.filename.textContent = state.filename || `Next: ${recordingFilename(new Date(), tab?.url)}`;
  if (state.checkpointAt) {
    ui.checkpoint.textContent = `Last disk save: ${new Date(state.checkpointAt).toLocaleTimeString()}`;
  } else {
    ui.checkpoint.textContent = active ? "The file commits every five minutes and when you stop." : "";
  }
  if (state.folder && active) ui.folder.textContent = `Folder: ${state.folder}`;
  ui["mic-note"].textContent = micNote();
}

function render() {
  const active = isActivePhase(state.phase);
  ui.state.textContent = state.phase === "idle" ? "READY" : state.phase.toUpperCase();
  ui.meeting.textContent = active ? state.title : tab?.title || "Open a tab to record";
  renderButtons(active);
  renderStatus(active);
  renderDetails(active);
}

/** Check encoder support and access, and update the guidance text. */
async function checkSetup() {
  configured = false;
  setupError = "";
  let summary = "";
  try {
    chooseMimeType();
    const settings = await loadSettings();
    ui.folder.textContent = settings.directory ? `Folder: ${describeFolder(settings)}` : "No recording folder selected";

    const missing = await missingAccess(settings, navigator.permissions);
    const micMissing = missing.includes("microphone access");
    ui["mic-permission"].textContent = !settings.includeMic ? "Microphone: off (tab audio only)"
      : micMissing ? "Microphone: permission needed" : "Microphone: allowed";

    configured = missing.length === 0;
    setupMessage = missing.length
      ? `Press Start recording. Chrome will ask for ${missing.join(" and ")}.`
      : "";
    if (!isRecordablePage(tab?.url)) {
      setupMessage = "Select a web page tab, then reopen GoatMeet from the Chrome toolbar.";
    }
    summary = `${settings.includeMic}:${missing.join(",")}`;
  } catch (error) {
    setupError = setupMessage = summary = error.message;
  }
  // The toolbar shows the same access state. Redraw it only when that state changed.
  if (summary !== lastToolbarSummary) {
    lastToolbarSummary = summary;
    notify(TARGET.controller, "refresh-toolbar");
  }
}

async function refresh() {
  if (refreshing || pending) return;
  refreshing = true;
  try {
    if (!isActivePhase(state.phase)) await checkSetup();
    state = await controllerCommand("status");
    if (state.phase !== actionErrorPhase) actionError = "";
    render();
  } catch (error) {
    ui.status.textContent = error.message;
  } finally {
    refreshing = false;
  }
}

/**
 * Open the access page in a new tab. A toolbar popup closes when Chrome's folder picker takes
 * focus, so a real page requests the missing access on its own and then starts the recording.
 * A tab is used rather than a popup window because an extension popup window cannot be closed
 * reliably on every Chrome build, while a tab always can.
 */
function openAccessPage() {
  return chrome.tabs.create({ url: chrome.runtime.getURL(`permissions.html?tabId=${tab.id}`) });
}

async function runAction(type) {
  pending = true;
  actionError = "";
  render();
  try {
    if (type === "start") {
      await checkSetup();
      if (setupError) throw new Error(setupError);
      // Access is missing, so hand off to the page that can open Chrome's folder picker.
      if (!configured) {
        await openAccessPage();
        return;
      }
    }
    state = await controllerCommand(type, { tabId: tab?.id });
  } catch (error) {
    actionError = error.message;
    actionErrorPhase = state.phase;
  } finally {
    pending = false;
    render();
  }
}

for (const type of ["start", "stop", "mute"]) {
  ui[type].addEventListener("click", () => runAction(type));
}
ui.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());

try {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await refresh();
} catch (error) {
  setupMessage = error.message;
  render();
}
setInterval(refresh, 1000);
