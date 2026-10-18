// The real microphone and WebSocket behind AsrClient. Kept thin so the logic lives in AsrClient (tested with fakes).
// Audio goes microphone -> AudioWorklet -> this page's memory -> WebSocket. It is never written to storage.
import { config } from '../config';
import type { Capture, SocketLike } from './AsrClient';
import workletUrl from './pcm-worklet.js?url';

const FLUSH_WAIT_MS = 300;

export async function createBrowserCapture(onEnded: () => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const context = new AudioContext();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    stream.getTracks().forEach((track) => track.stop());
    void context.close().catch(() => undefined);
  };
  let node: AudioWorkletNode;
  try {
    await context.audioWorklet.addModule(workletUrl);
    if (context.state === 'suspended') await context.resume();
    node = new AudioWorkletNode(context, 'pcm-downsampler');
  } catch (error) {
    release();
    throw error;
  }
  const silent = context.createGain(); // keeps the node in the graph; nothing is played
  silent.gain.value = 0;
  const source = context.createMediaStreamSource(stream);
  source.connect(node);
  node.connect(silent).connect(context.destination);
  // unplugging or revoking the microphone ends its track
  stream.getAudioTracks().forEach((track) => {
    track.onended = () => {
      if (!released) onEnded();
    };
  });

  let onFrame: ((frame: ArrayBuffer) => void) | null = null;
  let onLevel: ((level: number) => void) | null = null;
  let flushWaiter: (() => void) | null = null;
  node.port.onmessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) onFrame?.(event.data);
    else if ((event.data as { flushed?: boolean })?.flushed) flushWaiter?.();
    else if (typeof (event.data as { level?: number })?.level === 'number')
      onLevel?.((event.data as { level: number }).level);
  };
  return {
    start(callback, levelCallback) {
      onFrame = callback;
      onLevel = levelCallback ?? null;
    },
    flush() {
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, FLUSH_WAIT_MS);
        flushWaiter = () => {
          clearTimeout(timer);
          resolve();
        };
        node.port.postMessage('flush');
      });
    },
    stop() {
      onFrame = null;
      onLevel = null;
      release();
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
    },
  };
}

export function openBrowserSocket(sessionId: string): SocketLike {
  const socket = new WebSocket(`${config.asrWsUrl}/ws/sessions/${sessionId}/audio`);
  socket.binaryType = 'arraybuffer';
  return socket as unknown as SocketLike;
}
