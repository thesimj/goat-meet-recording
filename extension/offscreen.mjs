// Offscreen document: owns the capture, the audio mix, the encoder, and the file writer.
// It outlives the popup and the service worker, so a recording survives both closing.
import { newRecordingFile } from "./lib/filenames.mjs";
import { notify, reply } from "./lib/messaging.mjs";
import {
  chooseMimeType, createCheckpointWriter, mixAudio, muteMicrophone, recordToFile, stopStreams,
} from "./lib/recording.mjs";
import {
  describeFolder, folderGranted, isActivePhase, microphoneGranted, SAVED_BADGE_MS, TARGET,
} from "./lib/shared.mjs";
import { loadSettings } from "./lib/storage.mjs";

const TAB_VIDEO = { maxWidth: 1920, maxHeight: 1080, maxFrameRate: 30 };
/** How long the "saved" state stays before the toolbar returns to ready: just past the badge. */
const SAVED_DISPLAY_MS = SAVED_BADGE_MS + 100;

let state = { phase: "idle" };
let tabStream;
let micStream;
let mix;
let writer;
let session;
/** The recording file and its folder, kept so a failed recording can remove an empty file. */
let file;
let folder;
let stopReason = "";
let toolbarTimer;

/** Merge values into the state and tell the service worker. */
function update(values = {}) {
  state = { ...state, ...values };
  notify(TARGET.controller, "update", { state });
}

async function cleanup() {
  clearInterval(toolbarTimer);
  stopStreams(mix?.stream, tabStream, micStream);
  if (mix) await mix.context.close().catch(() => {});
  tabStream = micStream = mix = writer = session = file = folder = undefined;
}

/** A file that never received a committed byte is empty; leave no zero-byte MP4 behind. */
async function discardEmptyFile() {
  if (file && folder && !state.committedBytes) await folder.removeEntry(file.name).catch(() => {});
}

async function captureTab(streamId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, ...TAB_VIDEO } },
  });
  if (!stream.getVideoTracks().length || !stream.getAudioTracks().length) {
    throw new Error("Chrome did not provide tab video and audio.");
  }
  return stream;
}

async function captureMicrophone(settings) {
  if (!(await microphoneGranted())) {
    throw new Error("Open Recording settings and allow microphone access first.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(settings.deviceId ? { deviceId: { exact: settings.deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
}

async function loadReadySettings() {
  const settings = await loadSettings();
  if (!(await folderGranted(settings.directory))) {
    throw new Error("Open Recording settings and allow access to your recording folder.");
  }
  return settings;
}

/** Stop when the captured tab closes or the microphone disconnects. */
function stopOnTrackEnd(tracks) {
  for (const track of tracks) {
    track.addEventListener("ended", () => {
      if (state.phase === "recording") {
        stopReason = "The recording tab or microphone disconnected. ";
        session.stop();
      }
    }, { once: true });
  }
}

async function finish(result) {
  await cleanup();
  const warning = result.warning ? `${result.warning} ` : "";
  update({
    phase: "saved",
    savedAt: Date.now(),
    bytes: result.bytes,
    warning: Boolean(result.warning || stopReason),
    message: `${stopReason}${warning}Saved ${state.filename}.`,
  });
  setTimeout(() => update(), SAVED_DISPLAY_MS);
}

async function fail(error) {
  await discardEmptyFile();
  await cleanup();
  const retained = state.committedBytes
    ? " The file retains the last committed data, but playback may require repair."
    : "";
  update({ phase: "error", message: `${error.message}${retained}` });
}

async function start({ streamId, tabId, title, meetingUrl }) {
  if (isActivePhase(state.phase)) throw new Error("A recording is already active.");
  state = { phase: "starting", tabId, title, bytes: 0, micMuted: false, message: "Starting recording…" };
  stopReason = "";
  update();

  try {
    chooseMimeType();
    tabStream = await captureTab(streamId);
    const settings = await loadReadySettings();
    if (settings.includeMic) micStream = await captureMicrophone(settings);

    mix = mixAudio(tabStream, micStream);
    await mix.context.resume();

    folder = settings.directory;
    file = await newRecordingFile(folder, new Date(), meetingUrl);
    writer = await createCheckpointWriter(file, {
      onCheckpoint({ bytes, committedAt }) {
        state.committedBytes = bytes;
        state.checkpointAt = committedAt;
      },
    });

    const tracks = [...tabStream.getTracks(), ...(micStream?.getTracks() || [])];
    if (tracks.some((track) => track.readyState !== "live")) throw new Error("A recording source disconnected.");

    session = recordToFile(mix.stream, writer, {
      onProgress(bytes) { state.bytes = bytes; },
      onStopping() { update({ phase: "stopping", message: "Finishing your MP4…", endedAt: Date.now() }); },
    });
    stopOnTrackEnd(tracks);

    update({
      phase: "recording",
      startedAt: Date.now(),
      filename: file.name,
      folder: describeFolder(settings),
      includeMic: Boolean(micStream),
      message: "Recording this tab. You can switch tabs now.",
    });
    // Refresh the toolbar tooltip (elapsed time) once per second.
    toolbarTimer = setInterval(update, 1000);
    session.done.then(finish, fail);
    return state;
  } catch (error) {
    if (writer) await writer.abort().catch(() => {});
    await discardEmptyFile();
    await cleanup();
    update({ phase: "error", message: `${error.message} No recording started.` });
    throw error;
  }
}

function stop() {
  if (state.phase === "recording") session.stop();
  return state;
}

function toggleMute() {
  if (state.phase === "recording" && micStream) {
    muteMicrophone(micStream, !state.micMuted);
    update({ micMuted: !state.micMuted });
  }
  return state;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== TARGET.recorder) return;
  let operation;
  if (message.type === "start") operation = start(message);
  else if (message.type === "status") operation = Promise.resolve(state);
  else if (message.type === "stop") operation = Promise.resolve(stop());
  else if (message.type === "mute") operation = Promise.resolve(toggleMute());
  else operation = Promise.reject(new Error("Unknown recorder command."));
  return reply(operation, respond);
});
