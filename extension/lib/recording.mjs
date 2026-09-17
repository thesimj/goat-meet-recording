// Capture, audio mixing, encoding, and file writing. Pure browser APIs, no Chrome extension APIs.

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
];

export const VIDEO_BITS_PER_SECOND = 4_000_000;
export const AUDIO_BITS_PER_SECOND = 128_000;
export const CHUNK_INTERVAL_MS = 1000;
export const CHECKPOINT_INTERVAL_MS = 300_000;

/** Stop capture when this much data waits for the disk. */
const MAX_PENDING_BYTES = 64 * 1024 * 1024;

/** Pick the first H.264 + AAC MP4 type Chrome can record, or throw. */
export function chooseMimeType(Recorder = globalThis.MediaRecorder) {
  const mimeType = MIME_CANDIDATES.find((type) => Recorder?.isTypeSupported(type));
  if (!mimeType) {
    throw new Error("This Chrome installation cannot record H.264 + AAC MP4. Try current Google Chrome on Windows or macOS.");
  }
  return mimeType;
}

/**
 * Combine tab audio and the optional microphone into one track.
 * Tab audio also plays through the speakers, because tabCapture silences normal playback.
 * The microphone is never monitored, so the user does not hear their own voice.
 */
export function mixAudio(tabStream, micStream) {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const compressor = context.createDynamicsCompressor();
  compressor.connect(destination);

  const tabSource = context.createMediaStreamSource(tabStream);
  tabSource.connect(compressor);
  tabSource.connect(context.destination);

  if (micStream) context.createMediaStreamSource(micStream).connect(compressor);

  const stream = new MediaStream([
    ...tabStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ]);
  return { context, stream };
}

/** Mute by disabling tracks. The tracks stay live, so unmuting is instant. */
export function muteMicrophone(micStream, muted) {
  for (const track of micStream?.getAudioTracks() || []) track.enabled = !muted;
}

export function stopStreams(...streams) {
  for (const stream of streams) {
    for (const track of stream?.getTracks() || []) track.stop();
  }
}

/**
 * Write to a file handle and commit periodically.
 * Closing a writable stream is the only way to flush data to the real file.
 * After a commit the stream reopens with keepExistingData and appends at the previous offset.
 * Chrome may copy the existing file on reopen, so the interval stays long.
 */
export async function createCheckpointWriter(file, { intervalMs = CHECKPOINT_INTERVAL_MS, onCheckpoint = () => {} } = {}) {
  let writable = await file.createWritable();
  let bytes = 0;
  let committedAt = Date.now();

  async function commit() {
    if (!writable) return;
    await writable.close();
    writable = undefined;
    committedAt = Date.now();
    onCheckpoint({ bytes, committedAt });
  }

  async function reopen() {
    writable = await file.createWritable({ keepExistingData: true });
    await writable.seek(bytes);
  }

  return {
    async write(blob) {
      if (!writable) await reopen();
      await writable.write(blob);
      bytes += blob.size;
      if (Date.now() - committedAt >= intervalMs) await commit();
    },
    close: commit,
    async abort() {
      if (writable) await writable.abort();
      writable = undefined;
    },
  };
}

/**
 * Record a stream into a writer, one chunk per second, in order.
 * Resolves with { bytes, mimeType, warning } once the writer is closed.
 * Rejects when the file cannot be saved. The writer is aborted in that case.
 */
export function recordToFile(stream, writer, { onProgress = () => {}, onStopping = () => {} } = {}) {
  const recorder = new MediaRecorder(stream, {
    mimeType: chooseMimeType(),
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  });

  let queue = Promise.resolve();
  let bytes = 0;
  let pendingBytes = 0;
  let writeError;
  let recordingError;
  let stopping = false;

  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // The caller may attach its handler later. Avoid an unhandled rejection in between.
  done.catch(() => {});

  function stop() {
    if (!stopping) {
      stopping = true;
      onStopping();
      if (recorder.state !== "inactive") recorder.stop();
    }
    return done;
  }

  function enqueue(data) {
    pendingBytes += data.size;
    queue = queue
      .then(async () => {
        if (writeError) return;
        await writer.write(data);
        bytes += data.size;
        pendingBytes -= data.size;
        onProgress(bytes);
      })
      .catch((error) => {
        writeError = error;
        stop();
      });
    if (pendingBytes > MAX_PENDING_BYTES) {
      recordingError ||= new Error("The disk could not keep pace. GoatMeet stopped early.");
      stop();
    }
  }

  recorder.ondataavailable = ({ data }) => {
    if (data.size && !writeError) enqueue(data);
  };

  recorder.onerror = ({ error }) => {
    recordingError = error || new Error("Chrome stopped the encoder.");
    stop();
  };

  recorder.onstop = async () => {
    // Chrome may end the recorder on its own; mark the stop once, without a second onStopping.
    stop();
    await queue;
    try {
      if (writeError) throw writeError;
      if (!bytes) throw new Error("Chrome produced no recording data.");
      await writer.close();
      resolveDone({ bytes, mimeType: recorder.mimeType, warning: recordingError?.message });
    } catch (error) {
      await writer.abort().catch(() => {});
      rejectDone(new Error(`The recording could not be saved: ${error.message}`));
    }
  };

  recorder.start(CHUNK_INTERVAL_MS);
  return { recorder, stop, done };
}
