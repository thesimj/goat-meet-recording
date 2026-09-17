// Thin wrappers around chrome.runtime.sendMessage with a shared reply shape.
// Every reply is { ok: true, state } or { ok: false, error }.
import { TARGET } from "./shared.mjs";

async function send(target, type, data) {
  const reply = await chrome.runtime.sendMessage({ target, type, ...data });
  if (!reply?.ok) throw new Error(reply?.error || "GoatMeet did not respond.");
  return reply.state;
}

/** Ask the service worker to do something: status, start, stop, mute, refresh-toolbar. */
export function controllerCommand(type, data = {}) {
  return send(TARGET.controller, type, data);
}

/** Ask the offscreen recorder to do something: status, start, stop, mute. */
export function recorderCommand(type, data = {}) {
  return send(TARGET.recorder, type, data);
}

/** Fire-and-forget notification. Failures are expected when no listener is alive. */
export function notify(target, type, data = {}) {
  chrome.runtime.sendMessage({ target, type, ...data }).catch(() => {});
}

/**
 * Resolve an async handler into the shared reply shape.
 * Returns true so Chrome keeps the message channel open for the async reply.
 */
export function reply(operation, respond) {
  operation.then(
    (state) => respond({ ok: true, state }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
}
