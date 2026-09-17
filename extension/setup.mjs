// Options page: choose the recording folder and microphone. Every change saves at once.
import { recordingFilename } from "./lib/filenames.mjs";
import { notify } from "./lib/messaging.mjs";
import { stopStreams } from "./lib/recording.mjs";
import {
  describeFolder, FOLDER_PICKER_OPTIONS, folderGranted, microphoneGranted, pageElements, setStatus, TARGET,
  useRecordingFolder,
} from "./lib/shared.mjs";
import { loadSettings, saveSettings } from "./lib/storage.mjs";

const ui = pageElements(document);

let settings;
let busy = false;

/** Disable everything while an action runs or before settings load. */
function updateControls() {
  for (const element of document.querySelectorAll("button, input, select")) element.disabled = busy || !settings;
  ui.microphone.disabled ||= !settings?.includeMic;
  ui["allow-mic"].disabled ||= !settings?.includeMic;
  ui["folder-path"].disabled ||= !settings?.directory;
}

const showStatus = (message, options) => setStatus(ui.status, message, options);

/** Preview a full video path from the display-only folder path the user typed. */
function videoPathPreview(path) {
  if (!path) return "Enter the full folder path above to preview a video path.";
  const separator = path.includes("\\") ? "\\" : "/";
  return `Video path example (from your entry): ${path.replace(/[\\/]+$/, "")}${separator}${recordingFilename()}`;
}

async function renderReadiness() {
  ui.folder.textContent = settings.directory ? `Folder: ${describeFolder(settings)}` : "Default: Videos / goatmeet";
  ui["folder-path"].value = settings.folderPath || "";
  ui["video-path"].textContent = videoPathPreview(settings.folderPath || "");

  const folderReady = await folderGranted(settings.directory);
  ui["allow-folder"].hidden = !settings.directory || folderReady;
  const micReady = !settings.includeMic || (await microphoneGranted(navigator.permissions));

  if (folderReady && micReady) showStatus("Ready. Open GoatMeet on the tab you want to record and press Start recording.");
  else if (!folderReady) showStatus("Choose a recording folder and allow access.");
  else showStatus("Allow microphone access to include your voice.");

  notify(TARGET.controller, "refresh-toolbar");
}

/** Run a change, save it, and refresh. A cancelled picker is not an error. */
async function runAction(task) {
  if (busy || !settings) return;
  busy = true;
  updateControls();
  try {
    await task();
    await saveSettings(settings);
    await renderReadiness();
  } catch (error) {
    const cancelled = error.name === "AbortError";
    showStatus(cancelled ? "Cancelled. Your settings have not changed." : error.message, { error: !cancelled });
  } finally {
    busy = false;
    updateControls();
  }
}

/** Fill the microphone list. Labels are only available after microphone access is granted. */
async function listMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  ui.microphone.replaceChildren(new Option("System default", ""));
  const inputs = devices.filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default");
  for (const device of inputs) ui.microphone.add(new Option(device.label || "Microphone", device.deviceId));
  ui.microphone.value = settings.deviceId;
  if (ui.microphone.selectedIndex < 0) {
    ui.microphone.add(new Option("Previously selected microphone (unavailable)", settings.deviceId));
    ui.microphone.value = settings.deviceId;
  }
}

function chooseFolder(subfolder) {
  return runAction(async () => {
    const chosen = await window.showDirectoryPicker(FOLDER_PICKER_OPTIONS);
    await useRecordingFolder(settings, chosen, { subfolder });
  });
}

ui["default-folder"].addEventListener("click", () => chooseFolder(true));
ui["custom-folder"].addEventListener("click", () => chooseFolder(false));
ui["allow-folder"].addEventListener("click", () => runAction(async () => {
  if ((await settings.directory.requestPermission({ mode: "readwrite" })) !== "granted") {
    throw new Error("Folder access was not granted.");
  }
}));
ui["folder-path"].addEventListener("change", () => runAction(async () => {
  settings.folderPath = ui["folder-path"].value.trim();
}));
ui["include-mic"].addEventListener("change", () => runAction(async () => {
  settings.includeMic = ui["include-mic"].checked;
}));
ui.microphone.addEventListener("change", () => runAction(async () => {
  settings.deviceId = ui.microphone.value;
}));
ui["allow-mic"].addEventListener("click", () => runAction(async () => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    await listMicrophones();
  } finally {
    stopStreams(stream);
  }
}));

updateControls();
try {
  settings = await loadSettings();
  ui["include-mic"].checked = settings.includeMic;
  ui.filename.textContent = recordingFilename();
  if (await microphoneGranted(navigator.permissions)) await listMicrophones();
  await renderReadiness();
} catch (error) {
  showStatus(error.message, { error: true });
}
updateControls();
