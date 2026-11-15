/* ============================================================
   loopcapture.js — the AudioWorklet that carries the microphone into the
   Loop Station. It runs on the audio thread, so no sample is dropped when the
   page is busy (the ScriptProcessor it replaces ran on the page and could).

   Every 1024 frames it posts { d, frame }: the samples of channel 0 and the
   audio-clock frame the first one belongs to. The page turns `frame` into a
   time on the same clock the loops play on, which keeps overdubs exact.
   ============================================================ */
class LoopCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
    this.frame = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0];
    if (outputs[0] && outputs[0][0]) outputs[0][0].fill(0);   /* nothing to hear; the node only listens */
    const len = inp ? inp.length : 128;
    if (this.n === 0) this.frame = currentFrame;
    for (let i = 0; i < len; i++) this.buf[this.n + i] = inp ? inp[i] : 0;
    this.n += len;
    if (this.n >= this.buf.length) {
      const d = this.buf.slice(0, this.n);
      this.port.postMessage({ d, frame: this.frame }, [d.buffer]);
      this.n = 0;
    }
    return true;
  }
}
registerProcessor('loop-capture', LoopCapture);
