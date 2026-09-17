// Helpers shared by the service worker, the offscreen recorder, and the pages.

/** Phases during which the recorder owns the captured tab. */
export const ACTIVE_PHASES = Object.freeze(["starting", "recording", "stopping"]);

/** Message targets used with chrome.runtime.sendMessage. */
export const TARGET = Object.freeze({ controller: "controller", recorder: "recorder" });

/** How long the toolbar shows the saved checkmark before returning to ready. */
export const SAVED_BADGE_MS = 5000;

export function isActivePhase(phase) {
  return ACTIVE_PHASES.includes(phase);
}

/** Only http(s) pages can be captured and named. */
export function isRecordablePage(url) {
  return /^https?:\/\//.test(url || "");
}

/** Format a duration in milliseconds as HH:MM:SS. */
export function formatElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return parts.map((value) => String(value).padStart(2, "0")).join(":");
}

/** Elapsed recording time for a recorder state, or zero before the recording starts. */
export function elapsedFor(state, now = Date.now()) {
  if (!state?.startedAt) return 0;
  return (state.endedAt || now) - state.startedAt;
}

export function formatMegabytes(bytes) {
  return `${((bytes || 0) / 1_000_000).toFixed(1)} MB`;
}

/** Map every element with an id to a lookup object. */
export function pageElements(root) {
  return Object.fromEntries([...root.querySelectorAll("[id]")].map((element) => [element.id, element]));
}

/** Show a message in a status element, styled as an error when asked. */
export function setStatus(element, message, { error = false } = {}) {
  element.textContent = message;
  element.classList.toggle("error", error);
}

/** Options for window.showDirectoryPicker. Chrome starts in the OS Videos folder. */
export const FOLDER_PICKER_OPTIONS = Object.freeze({ startIn: "videos", mode: "readwrite" });

export const DEFAULT_SUBFOLDER = "goatmeet";

/**
 * Store a picked directory in the settings.
 * With `subfolder`, GoatMeet records into a `goatmeet` folder inside the chosen one.
 * The display-only path is cleared, because it described the previous folder.
 */
export async function useRecordingFolder(settings, chosen, { subfolder = true } = {}) {
  settings.directory = subfolder ? await chosen.getDirectoryHandle(DEFAULT_SUBFOLDER, { create: true }) : chosen;
  settings.folderLabel = subfolder ? `${chosen.name} / ${DEFAULT_SUBFOLDER}` : chosen.name;
  settings.folderPath = "";
  return settings;
}

/** Human-readable label for the selected recording folder. */
export function describeFolder(settings) {
  if (!settings?.directory) return "";
  return settings.folderLabel || settings.directory.name;
}

/** True when the stored directory handle still allows writing without a prompt. */
export async function folderGranted(directory) {
  if (!directory) return false;
  return (await directory.queryPermission({ mode: "readwrite" })) === "granted";
}

/** True when Chrome already allows this extension to use the microphone. */
export async function microphoneGranted(permissions = globalThis.navigator?.permissions) {
  if (!permissions) return false;
  return (await permissions.query({ name: "microphone" })).state === "granted";
}

/** Access still missing before a recording can start, as short labels. */
export async function missingAccess(settings, permissions) {
  const missing = [];
  if (!settings.directory) missing.push("folder selection");
  else if (!(await folderGranted(settings.directory))) missing.push("folder access");
  if (settings.includeMic && !(await microphoneGranted(permissions))) missing.push("microphone access");
  return missing;
}
