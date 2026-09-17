import { createCheckpointWriter, mixAudio, recordToFile, stopStreams } from "../../extension/lib/recording.mjs";

const button = document.querySelector("#run");
const result = document.querySelector("#result");
const canvas = document.querySelector("#picture");
const video = document.querySelector("#playback");
let playbackUrl;

button.addEventListener("click", async () => {
  button.disabled = true;
  result.textContent = "Recording synthetic sources…";
  const context = new AudioContext();
  const remote = context.createMediaStreamDestination();
  const local = context.createMediaStreamDestination();
  const oscillators = [440, 880].map((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = 0.03;
    oscillator.connect(gain).connect(index ? local : remote);
    oscillator.start();
    return oscillator;
  });
  const pixels = canvas.getContext("2d");
  let frame = 0;
  const paint = () => {
    pixels.fillStyle = "#1a2420";
    pixels.fillRect(0, 0, 640, 360);
    pixels.fillStyle = "#c7ed97";
    pixels.font = "28px sans-serif";
    pixels.fillText(`GoatMeet · frame ${frame++}`, 40, 180);
  };
  paint();
  const animation = setInterval(paint, 50);
  const picture = canvas.captureStream(20);
  const tab = new MediaStream([...picture.getVideoTracks(), ...remote.stream.getAudioTracks()]);
  const mix = mixAudio(tab, local.stream);
  let session;
  try {
    await context.resume();
    await mix.context.resume();
    const directory = await navigator.storage.getDirectory();
    const file = await directory.getFileHandle("goatmeet-synthetic-check.mp4", { create: true });
    const checkpoints = [];
    const writer = await createCheckpointWriter(file, {
      intervalMs: 500,
      onCheckpoint(checkpoint) { checkpoints.push(checkpoint); },
    });
    session = recordToFile(mix.stream, writer);
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const saved = await session.stop();
    if (saved.warning) throw new Error(saved.warning);
    const blob = await file.getFile();
    if (checkpoints.length < 2) throw new Error("The check did not exercise periodic commits.");
    const header = new TextDecoder("latin1").decode(await blob.slice(0, 32).arrayBuffer());
    if (!header.includes("ftyp")) throw new Error("The output lacks an MP4 header.");
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("MP4 playback timed out.")), 10000);
      video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
      video.onerror = () => { clearTimeout(timeout); reject(new Error("Chrome could not decode the MP4.")); };
      video.src = playbackUrl;
      video.load();
    });
    if (video.videoWidth !== 640 || video.videoHeight !== 360) throw new Error("Unexpected recorded dimensions.");
    result.textContent = `PASS: ${saved.mimeType}; ${saved.bytes} bytes; ${checkpoints.length} disk commits; ${video.videoWidth}×${video.videoHeight}; MP4 playback loaded.`;
    result.dataset.outcome = "pass";
  } catch (error) {
    result.textContent = `FAIL: ${error.message}`;
    result.dataset.outcome = "fail";
  } finally {
    if (session) await session.stop().catch(() => {});
    clearInterval(animation);
    oscillators.forEach((oscillator) => oscillator.stop());
    stopStreams(picture, remote.stream, local.stream, mix.stream);
    await mix.context.close();
    await context.close();
    button.disabled = false;
  }
});
