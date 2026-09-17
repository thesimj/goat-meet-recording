// Toolbar icon, badge, and tooltip derived from the recorder state.
import { formatElapsed, SAVED_BADGE_MS } from "./shared.mjs";

export const COLORS = Object.freeze({
  ready: "#20834b",
  permission: "#a86208",
  starting: "#a86208",
  recording: "#d52c38",
  stopping: "#2469b5",
  saved: "#20834b",
  error: "#c92b36",
  unsupported: "#687580",
});

/**
 * Decide what the toolbar shows.
 * @param {object} state recorder state from the offscreen document
 * @param {{supported?: boolean, missing?: string}} availability
 *   `supported` is false for a tab that is not an http(s) page, true for a web page,
 *   and undefined when Chrome has not shared the tab URL yet.
 */
export function toolbarState(state, availability = {}, now = Date.now()) {
  let phase = state.phase;
  let title = "";
  let text = "";

  if (phase === "recording") {
    const elapsed = formatElapsed(now - state.startedAt);
    const muted = state.micMuted ? " - recording mic muted" : "";
    text = "REC";
    title = `Recording ${state.title || "this tab"} - ${elapsed}${muted}`;
  } else if (phase === "starting") {
    text = "…";
    title = "Starting recording";
  } else if (phase === "stopping") {
    text = "SAVE";
    title = "Saving your MP4 - keep Chrome open";
  } else if (phase === "error") {
    text = "ERR";
    title = state.message || "Recording failed";
  } else if (phase === "saved" && state.warning) {
    phase = "permission";
    text = "!";
    title = state.message;
  } else if (phase === "saved" && now - state.savedAt < SAVED_BADGE_MS) {
    text = "✓";
    title = `Saved ${state.filename}`;
  } else if (availability.supported === false) {
    phase = "unsupported";
    title = "Open a web page tab to record";
  } else if (availability.missing) {
    phase = "permission";
    text = "!";
    title = `${availability.missing} - press Start recording to allow access`;
  } else {
    phase = "ready";
    title = "Ready - start recording this tab";
  }

  return { phase, color: COLORS[phase], text, title: `GoatMeet - ${title}` };
}

function fillPolygon(context, points) {
  context.beginPath();
  context.moveTo(...points[0]);
  for (const point of points.slice(1)) context.lineTo(...point);
  context.closePath();
  context.fill();
}

/** Draw the goat on a 32-unit grid, scaled to the requested size. */
export function drawGoat(context, size, phase) {
  context.scale(size / 32, size / 32);

  context.fillStyle = COLORS[phase];
  context.beginPath();
  context.roundRect(1, 1, 30, 30, 7);
  context.fill();

  // Horns, ears, head, and beard form one readable silhouette at toolbar size.
  context.fillStyle = "#ffffff";
  fillPolygon(context, [[11, 13], [8, 3], [12, 6], [15, 14]]);
  fillPolygon(context, [[21, 13], [24, 3], [20, 6], [17, 14]]);
  fillPolygon(context, [[12, 13], [4, 11], [7, 18], [12, 18]]);
  fillPolygon(context, [[20, 13], [28, 11], [25, 18], [20, 18]]);
  fillPolygon(context, [[10, 12], [22, 12], [21, 23], [18, 26], [16, 30], [14, 26], [11, 23]]);

  context.fillStyle = "#17221c";
  context.fillRect(12, 17, 3, 2);
  context.fillRect(17, 17, 3, 2);

  if (!["recording", "saved", "error"].includes(phase)) return;

  // Status disc in the lower right corner.
  context.fillStyle = COLORS[phase];
  context.strokeStyle = "#ffffff";
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(25, 25, 6, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = "#ffffff";
  if (phase === "saved") {
    context.beginPath();
    context.moveTo(21.5, 25);
    context.lineTo(24, 27.5);
    context.lineTo(28.5, 22.5);
    context.stroke();
  } else if (phase === "error") {
    context.fillRect(24, 21, 2, 5);
    context.fillRect(24, 27, 2, 2);
  } else {
    context.beginPath();
    context.arc(25, 25, 2.5, 0, Math.PI * 2);
    context.fill();
  }
}

let lastPhase;
let lastTitle;

/** Apply an appearance to chrome.action, skipping unchanged parts. */
export async function setToolbar(appearance) {
  if (appearance.phase !== lastPhase) {
    const imageData = {};
    for (const size of [16, 32]) {
      const context = new OffscreenCanvas(size, size).getContext("2d");
      drawGoat(context, size, appearance.phase);
      imageData[size] = context.getImageData(0, 0, size, size);
    }
    await chrome.action.setIcon({ imageData });
    await chrome.action.setBadgeBackgroundColor({ color: appearance.color });
    await chrome.action.setBadgeTextColor({ color: "#ffffff" });
    await chrome.action.setBadgeText({ text: appearance.text });
    lastPhase = appearance.phase;
  }
  if (appearance.title !== lastTitle) {
    await chrome.action.setTitle({ title: appearance.title });
    lastTitle = appearance.title;
  }
}
