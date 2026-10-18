/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// AudioWorklet (runs on the audio thread): microphone audio in, 16 kHz mono 16-bit PCM frames out.
// - Each output frame is 4000 samples = 250 ms = 8000 bytes (the speech service accepts up to 32 KiB per frame).
// - Down-sampling averages the input samples that fall into each output sample (a light low-pass), so 48 kHz and
//   44.1 kHz microphones both work. Stereo input uses the first channel.
// - Nothing is stored here: frames are posted to the page, which streams them and never writes them to disk or storage.
// Message in: 'flush' posts the partly filled frame, then { flushed: true } (used when the recording stops).
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 4000;

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.phase = 0; // position of the next output sample, in input samples, relative to the start of the block
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
    this.peak = 0; // loudest input sample since the last level report
    this.sinceLevel = 0;
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.emit(true);
        this.port.postMessage({ flushed: true }); // tells the page the last frame is on its way
      }
    };
  }

  emit(partial) {
    if (this.filled === 0 || (!partial && this.filled < FRAME_SAMPLES)) return;
    const out = this.frame.slice(0, this.filled).buffer;
    this.port.postMessage(out, [out]);
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;
    for (let i = 0; i < channel.length; i += 1)
      this.peak = Math.max(this.peak, Math.abs(channel[i]));
    this.sinceLevel += channel.length;
    if (this.sinceLevel >= sampleRate / 4) {
      this.port.postMessage({ level: this.peak }); // lets the page show a microphone level (0 to 1)
      this.peak = 0;
      this.sinceLevel = 0;
    }
    let position = this.phase;
    while (position < channel.length) {
      const from = Math.floor(position);
      const to = Math.min(channel.length, Math.max(from + 1, Math.round(position + this.ratio)));
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += channel[i];
      const value = Math.max(-1, Math.min(1, sum / (to - from)));
      this.frame[this.filled] = value < 0 ? value * 0x8000 : value * 0x7fff;
      this.filled += 1;
      if (this.filled === FRAME_SAMPLES) this.emit(false);
      position += this.ratio;
    }
    this.phase = position - channel.length;
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
