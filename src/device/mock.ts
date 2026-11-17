// A fake A75 Pro (firmware 0.023) for developing and testing the UI without hardware.

import { OP, PAYLOAD_SIZE } from './constants';
import type { KeyboardTransport } from './transport';

export class MockKeyboard implements KeyboardTransport {
  readonly kind = 'mock';
  readonly productName = 'DeerTune Mock A75 Pro';
  readonly productId = 0x2384;
  readonly sent: Uint8Array[] = [];
  state = { turbo: 0, rt: 0, lwRdt: 0, rtMatch: 0, tracking: false };
  private inputs = new Set<(d: Uint8Array) => void>();
  private disconnects = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private depth = new Float32Array(126);
  private pressed = new Set<number>();

  constructor(
    readonly typeBytes: [number, number, number] = [11, 4, 3],
    readonly fw: [lo: number, hi: number] = [23, 0],
  ) {}

  async open() {}
  async close() {
    this.stopStream();
  }

  async send(payload: Uint8Array) {
    this.sent.push(payload.slice());
    const op = payload[0];
    if (op === OP.IDENTITY && payload[2] === 0x00) return this.reply(this.identity());
    if (op === OP.COMMON_SWITCH) {
      this.state = { ...this.state, turbo: payload[7] ?? 0, rt: payload[8] ?? 0, lwRdt: payload[10] ?? 0, rtMatch: payload[11] ?? 0 };
    }
    if (op === OP.TRAVEL && payload[1] === 0x03) {
      this.state.tracking = payload[2] === 1;
      if (this.state.tracking) this.startStream();
      else this.stopStream();
    }
    // the firmware echoes most writes back with the same first byte
    if (op !== OP.LED) this.reply(payload.slice());
  }

  identity(): Uint8Array {
    const d = new Uint8Array(PAYLOAD_SIZE);
    d.set([OP.IDENTITY, 0x02, 0x00, 0x00, ...this.typeBytes, this.fw[0], this.fw[1]]);
    d[15] = this.state.turbo;
    d[16] = this.state.rt;
    d[18] = this.state.lwRdt & 2 ? 1 : 0;
    d[19] = this.state.lwRdt & 1;
    d[30] = this.state.rtMatch;
    d[31] = 255;
    return d;
  }

  /** Simulate pressing a key (for the live keystroke view). */
  press(slot: number, down: boolean) {
    if (down) this.pressed.add(slot);
    else this.pressed.delete(slot);
  }

  private startStream() {
    if (this.timer) return;
    let t = 0;
    this.timer = setInterval(() => {
      t += 1;
      // demo motion: WASD pulses when nothing is pressed manually
      const demo = this.pressed.size === 0;
      for (let s = 0; s < 126; s++) {
        let target = this.pressed.has(s) ? 3.6 : 0;
        if (demo && [44, 64, 65, 66].includes(s)) target = Math.max(0, Math.sin(t / 6 + s) * 3.6);
        this.depth[s] = (this.depth[s] ?? 0) + (target - (this.depth[s] ?? 0)) * 0.5;
      }
      for (let chunk = 0; chunk < 3; chunk++) {
        const d = new Uint8Array(PAYLOAD_SIZE);
        d.set([OP.TRACKING_STREAM, 0, 0, chunk]);
        const [start, n] = chunk < 2 ? [chunk * 59, 59] : [118, 8];
        for (let k = 0; k < n; k++) d[4 + k] = Math.min(255, Math.round((this.depth[start + k] ?? 0) * 100 * 0.55));
        this.reply(d);
      }
    }, 40);
  }

  private stopStream() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private reply(d: Uint8Array) {
    queueMicrotask(() => this.inputs.forEach((l) => l(d)));
  }

  onInput(l: (d: Uint8Array) => void) {
    this.inputs.add(l);
    return () => this.inputs.delete(l);
  }

  onDisconnect(l: () => void) {
    this.disconnects.add(l);
    return () => this.disconnects.delete(l);
  }

  disconnect() {
    this.stopStream();
    this.disconnects.forEach((l) => l());
  }
}
