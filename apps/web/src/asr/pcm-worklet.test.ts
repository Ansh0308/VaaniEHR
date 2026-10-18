// The AudioWorklet's down-sampler, run in jsdom with the worklet globals faked.
import { beforeAll, describe, expect, it } from 'vitest';

type Processor = {
  process(inputs: Float32Array[][]): boolean;
  port: {
    postMessage: (data: ArrayBuffer) => void;
    onmessage: ((e: { data: unknown }) => void) | null;
  };
};

let create: () => Processor;
const posted: ArrayBuffer[] = [];
const markers: unknown[] = [];

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = 48000;
  g.AudioWorkletProcessor = class {
    port = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      postMessage: (data: unknown) =>
        void (data instanceof ArrayBuffer ? posted.push(data) : markers.push(data)),
    };
  };
  g.registerProcessor = (_name: string, ctor: new () => Processor) => {
    create = () => new ctor();
  };
  // @ts-expect-error plain JavaScript module for the audio thread
  await import('./pcm-worklet.js');
});

const sine = (n: number, rate: number, offset = 0) =>
  Float32Array.from(
    { length: n },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * (i + offset)) / rate),
  );

describe('pcm-downsampler', () => {
  it('turns 48 kHz audio into 250 ms frames of 4000 samples (8000 bytes) at 16 kHz', () => {
    posted.length = 0;
    const p = create();
    for (let block = 0; block < 190; block += 1) p.process([[sine(128, 48000, block * 128)]]); // ~0.5 s
    expect(posted.length).toBe(2);
    expect(posted.every((b) => b.byteLength === 8000)).toBe(true);
    const samples = new Int16Array(posted[0] as ArrayBuffer);
    const peak = Math.max(...samples.map(Math.abs));
    expect(peak).toBeGreaterThan(0.4 * 32767);
    expect(peak).toBeLessThanOrEqual(32767);
  });

  it('flush posts the partly filled frame and nothing else', () => {
    posted.length = 0;
    const p = create();
    p.process([[sine(480, 48000)]]);
    expect(posted).toHaveLength(0);
    p.port.onmessage?.({ data: 'flush' });
    expect(posted).toHaveLength(1);
    expect((posted[0] as ArrayBuffer).byteLength).toBe(160 * 2); // 480 input samples -> 160 output samples
    p.port.onmessage?.({ data: 'flush' });
    expect(posted).toHaveLength(1);
  });

  it('silence stays silence and an empty input does not break the processor', () => {
    posted.length = 0;
    const p = create();
    expect(p.process([[]])).toBe(true);
    expect(p.process([])).toBe(true);
    p.process([[new Float32Array(480)]]);
    p.port.onmessage?.({ data: 'flush' });
    expect(new Int16Array(posted[0] as ArrayBuffer).every((v) => v === 0)).toBe(true);
  });
});

describe('microphone level', () => {
  it('reports the loudest sample about four times a second, and 0 for silence', () => {
    markers.length = 0;
    const loud = create();
    for (let block = 0; block < 190; block += 1) loud.process([[sine(128, 48000, block * 128)]]);
    const levels = markers.filter(
      (m): m is { level: number } => typeof (m as { level?: number }).level === 'number',
    );
    expect(levels.length).toBeGreaterThanOrEqual(2);
    expect(levels[0]?.level).toBeGreaterThan(0.45);
    markers.length = 0;
    const quiet = create();
    for (let block = 0; block < 190; block += 1) quiet.process([[new Float32Array(128)]]);
    expect(markers.every((m) => (m as { level?: number }).level === 0)).toBe(true);
  });
});
