import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { chooseMimeType, mixAudio, muteMicrophone, recordToFile, stopStreams } from "../extension/lib/recording.mjs";

class FakeRecorder {
  static isTypeSupported(type) { return type === "video/mp4;codecs=avc1,mp4a.40.2"; }
  constructor(stream, options) { this.mimeType = options.mimeType; this.state = "inactive"; }
  start() { this.state = "recording"; }
  emit(text) { this.ondataavailable({ data: new Blob([text]) }); }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => { this.emit("final"); this.onstop(); });
  }
}

function setup(t, overrides = {}) {
  t.mock.method(globalThis, "MediaRecorder", FakeRecorder);
  const events = [];
  const writer = {
    async write(blob) { await setImmediate(); events.push(await blob.text()); },
    async close() { events.push("close"); },
    async abort() { events.push("abort"); },
    ...overrides,
  };
  return { writer, events };
}

// Node does not expose browser media APIs. Restore this fake after each test.
globalThis.MediaRecorder = FakeRecorder;

test("requires H.264 and AAC rather than accepting generic MP4", () => {
  assert.match(chooseMimeType(FakeRecorder), /avc1,mp4a\.40\.2/);
  assert.throws(() => chooseMimeType({ isTypeSupported: (type) => type === "video/mp4" }), /cannot record/);
  assert.throws(() => chooseMimeType(null), /cannot record/);
});

test("serializes slow writes and includes the final chunk before closing", async (t) => {
  const { writer, events } = setup(t);
  const session = recordToFile({}, writer);
  session.recorder.emit("one");
  session.recorder.emit("two");
  const firstStop = session.stop();
  assert.equal(firstStop, session.stop());
  const result = await firstStop;
  assert.deepEqual(events, ["one", "two", "final", "close"]);
  assert.equal(result.bytes, 11);
});

test("a failed write stops recording and never claims a saved file", async (t) => {
  const { writer, events } = setup(t, { async write() { throw new Error("disk full"); } });
  const session = recordToFile({}, writer);
  session.recorder.emit("one");
  await assert.rejects(session.done, /disk full/);
  assert.deepEqual(events, ["abort"]);
  assert.equal(session.recorder.state, "inactive");
});

test("a failed close rejects the recording", async (t) => {
  const { writer, events } = setup(t, { async close() { throw new Error("permission revoked"); } });
  const session = recordToFile({}, writer);
  await assert.rejects(session.stop(), /permission revoked/);
  assert.deepEqual(events, ["final", "abort"]);
});

test("an encoder failure preserves received data and reports an early stop", async (t) => {
  const { writer, events } = setup(t);
  const session = recordToFile({}, writer);
  session.recorder.emit("partial");
  session.recorder.onerror({ error: new Error("encoder failed") });
  const result = await session.done;
  assert.equal(result.warning, "encoder failed");
  assert.deepEqual(events, ["partial", "final", "close"]);
});

test("no output fails instead of committing an empty file", async (t) => {
  const { writer, events } = setup(t);
  const session = recordToFile({}, writer);
  session.recorder.stop = function () { this.state = "inactive"; queueMicrotask(() => this.onstop()); };
  await assert.rejects(session.stop(), /no recording data/);
  assert.deepEqual(events, ["abort"]);
});

test("microphone mute leaves the tab audio and track lifetime unchanged", () => {
  const mic = { enabled: true };
  const remote = { enabled: true };
  const stream = { getAudioTracks: () => [mic] };
  muteMicrophone(stream, true);
  assert.equal(mic.enabled, false);
  assert.equal(remote.enabled, true);
  muteMicrophone(stream, false);
  assert.equal(mic.enabled, true);
  muteMicrophone(undefined, true);
});

test("mixes both voices but monitors only the meeting audio", (t) => {
  const connections = [];
  const video = { kind: "video" };
  const mixedAudio = { kind: "audio" };
  const tab = { getVideoTracks: () => [video] };
  const mic = {};
  class Context {
    destination = "speakers";
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [mixedAudio] } }; }
    createDynamicsCompressor() { return { connect(to) { connections.push(["compressor", to]); } }; }
    createMediaStreamSource(source) { return { connect(to) { connections.push([source, to]); } }; }
  }
  globalThis.AudioContext = Context;
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  t.after(() => { delete globalThis.AudioContext; delete globalThis.MediaStream; });
  const mixed = mixAudio(tab, mic);
  assert.deepEqual(mixed.stream.tracks, [video, mixedAudio]);
  assert.equal(connections.filter(([source]) => source === mic).length, 1);
  assert.ok(connections.some(([source, target]) => source === tab && target === "speakers"));
  assert.ok(!connections.some(([source, target]) => source === mic && target === "speakers"));
  assert.equal(connections.find(([source]) => source === mic)[1], connections.find(([source]) => source === tab)[1]);
});

test("cleanup stops all provided tracks and tolerates missing streams", () => {
  let count = 0;
  stopStreams(undefined, { getTracks: () => [{ stop() { count++; } }, { stop() { count++; } }] });
  assert.equal(count, 2);
});
