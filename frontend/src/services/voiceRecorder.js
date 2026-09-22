/**
 * Thin wrapper around MediaRecorder for voice notes.
 *
 * Deliberately module-scoped rather than a React hook: a recording outlives individual renders
 * (the user may scroll or switch panes mid-record), and keeping the recorder outside React avoids
 * StrictMode's double-invocation starting two simultaneous recordings on one microphone.
 */

let recorder = null;
let chunks = [];
let startedAt = 0;
let cancelled = false;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
];

/** Pick the best container the browser actually supports. Safari needs mp4, Chrome prefers webm. */
const pickMimeType = () => {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
};

export const isRecordingSupported = () =>
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof MediaRecorder !== "undefined";

export const isRecording = () => Boolean(recorder) && recorder.state === "recording";

export const startRecording = async () => {
  if (!isRecordingSupported()) {
    throw new Error("Recording is not supported on this device");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();

  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  chunks = [];
  cancelled = false;
  startedAt = Date.now();

  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  recorder.start();

  return { mimeType: mimeType || "audio/webm" };
};

/**
 * Stop and resolve the recording, or null if it was cancelled.
 * Always releases the microphone — otherwise the OS recording indicator stays lit and the next
 * attempt to record fails.
 */
export const stopRecording = () =>
  new Promise((resolve) => {
    if (!recorder) return resolve(null);

    const active = recorder;
    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));

    active.onstop = () => {
      active.stream?.getTracks().forEach((track) => track.stop());

      const blob = new Blob(chunks, { type: active.mimeType || "audio/webm" });
      const wasCancelled = cancelled;

      recorder = null;
      chunks = [];
      cancelled = false;

      resolve(wasCancelled ? null : { blob, durationSeconds, mimeType: blob.type });
    };

    try {
      active.stop();
    } catch {
      active.stream?.getTracks().forEach((track) => track.stop());
      recorder = null;
      resolve(null);
    }
  });

/** Abort without producing a file. */
export const cancelRecording = async () => {
  if (!recorder) return null;
  cancelled = true;
  return stopRecording();
};
