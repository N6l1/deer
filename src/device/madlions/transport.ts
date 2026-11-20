// MADLIONS transports (WebHID + mock), allow-list guard and guarded channel.

import {
  CHANNEL, CMD, findMadBoard, FLASH, KNOWN_PROTOCOL, MAD_EFFECTS, MAD_USAGE, MAD_USAGE_PAGE, MAD_VENDOR_ID, MAD68_BOARDS, MAX_ACT_READ,
  MAX_ACT_WRITE, MAX_RT_READ, MAX_RT_WRITE, MAX_TRAVEL_READ, REPORT, stripId, SUB, TOTAL, BRIGHTNESS_MAX, ADVANCED_SLOTS, COLS, MAD68_LAYOUT, type MadBoard,
} from './protocol';
import { toHexTrimmed } from '../packets';
import type { LogEntry } from '../transport';

export interface MadTransport {
  readonly kind: 'webhid' | 'mock' | string;
  readonly productId: number;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  send(r: Uint8Array): Promise<void>;
  onInput(l: (d: Uint8Array) => void): () => void;
  onDisconnect(l: () => void): () => void;
}

// ---- WebHID ----------------------------------------------------------------------------------------

const isVendor = (d: HIDDevice) => d.collections.some((c) => c.usagePage === MAD_USAGE_PAGE && c.usage === MAD_USAGE);

export class WebHidMadTransport implements MadTransport {
  readonly kind = 'webhid';
  constructor(private device: HIDDevice) {}
  get productId() {
    return this.device.productId;
  }
  get productName() {
    return this.device.productName;
  }
  static async request(): Promise<WebHidMadTransport | null> {
    const picked = await navigator.hid.requestDevice({
      filters: [...MAD68_BOARDS.map((b) => ({ vendorId: MAD_VENDOR_ID, productId: b.productId, usagePage: MAD_USAGE_PAGE, usage: MAD_USAGE })), { vendorId: MAD_VENDOR_ID, usagePage: MAD_USAGE_PAGE, usage: MAD_USAGE }],
    });
    if (!picked.length) return null;
    const d = picked.find(isVendor);
    if (!d) throw new Error('The browser did not give access to the keyboard’s configuration interface (usage page 0xFF60). Try again and pick another entry.');
    return new WebHidMadTransport(d);
  }
  async open() {
    if (!this.device.opened) await this.device.open();
  }
  async close() {
    if (this.device.opened) await this.device.close();
  }
  async send(r: Uint8Array) {
    await this.device.sendReport(0, r as BufferSource);
  }
  onInput(l: (d: Uint8Array) => void) {
    const h = (e: HIDInputReportEvent) => l(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
    this.device.addEventListener('inputreport', h);
    return () => this.device.removeEventListener('inputreport', h);
  }
  onDisconnect(l: () => void) {
    const h = (e: HIDConnectionEvent) => e.device === this.device && l();
    navigator.hid.addEventListener('disconnect', h);
    return () => navigator.hid.removeEventListener('disconnect', h);
  }
}

// ---- Mock ------------------------------------------------------------------------------------------

/** Simulated MAD68 HE RGB (protocol 9). Empty matrix cells behave like the real board. */
export class MockMad68 implements MadTransport {
  readonly kind = 'mock';
  readonly productName = 'DeerTune Mock MAD68 HE RGB';
  readonly sent: Uint8Array[] = [];
  act = Array<number>(TOTAL).fill(150);
  rt = Array.from({ length: TOTAL }, () => [0, 50, 50]);
  light = [2, 0, 128, 0xff, 0x6a, 0x1a, 150];
  features = [0, 0, 0, 0, 1];
  adv: number[][] = Array.from({ length: 16 }, (_, i) => (i === 3 ? [1, 0, 0, 50, 0, 0, 0, 0, 0, 0, 0] : Array(11).fill(0)));
  persisted = 0;
  private subs = new Set<(d: Uint8Array) => void>();
  private t0 = Date.now();
  constructor(readonly productId = 0x1058) {}
  async open() {}
  async close() {}
  onDisconnect() {
    return () => undefined;
  }
  onInput(l: (d: Uint8Array) => void) {
    this.subs.add(l);
    return () => void this.subs.delete(l);
  }
  private reply(bytes: number[]) {
    const r = new Uint8Array(REPORT);
    r.set(bytes.slice(0, REPORT));
    queueMicrotask(() => this.subs.forEach((l) => l(r)));
  }
  async send(p: Uint8Array) {
    this.sent.push(p.slice());
    const h = Array.from(p);
    if (p[0] === CMD.PROTOCOL) return this.reply([1, 0, 9]);
    if (p[0] === CMD.CUSTOM_GET && p[1] === SUB.LIGHT) return this.reply([8, 0x41, ...this.light]);
    if (p[0] === CMD.CUSTOM_SET && p[1] === SUB.LIGHT) {
      this.light = h.slice(2, 9);
      return this.reply(h);
    }
    if (p[1] !== CHANNEL) return this.reply([0xff]);
    if (p[2] === SUB.FEATURES) {
      if (p[0] === CMD.SET_VALUE) this.features = h.slice(3, 8);
      return this.reply([p[0]!, CHANNEL, SUB.FEATURES, ...this.features]);
    }
    if (p[2] === SUB.ADVANCED) {
      const i = p[6]!;
      if (p[0] === CMD.SET_VALUE) this.adv[i] = h.slice(7, 18);
      return this.reply([p[0]!, CHANNEL, SUB.ADVANCED, 0, 0, p[5]!, i, ...this.adv[i]!]);
    }
    const [sub, off, n] = [p[2]!, (p[5]! << 8) | p[6]!, p[7]!];
    const head = h.slice(0, 8);
    if (p[0] === CMD.GET_VALUE) {
      if (sub === SUB.ACTUATION) return this.reply([...head, ...this.act.slice(off, off + n).flatMap((v) => [v >> 8, v & 255])]);
      if (sub === SUB.RT) return this.reply([...head, ...this.rt.slice(off, off + n).flatMap(([e, r, q]) => [e!, r! >> 8, r! & 255, q! >> 8, q! & 255])]);
      if (sub === SUB.TRAVEL) {
        const t = (Date.now() - this.t0) / 1000;
        const depth = (s: number) => ([17, 31, 32, 33].includes(s) ? Math.max(0, Math.sin(t * 3 + s) * 360) : 0);
        return this.reply([...head, ...Array.from({ length: n }, (_, i) => Math.round(depth(off + i))).flatMap((v) => [v >> 8, v & 255])]);
      }
    }
    if (p[0] === CMD.SET_VALUE) {
      if (p[8] === FLASH.PERSIST) this.persisted++;
      if (sub === SUB.ACTUATION) for (let i = 0; i < n; i++) this.act[off + i] = (p[9 + i * 2]! << 8) | p[10 + i * 2]!;
      if (sub === SUB.RT) for (let i = 0; i < n; i++) this.rt[off + i] = [p[9 + i * 5]!, (p[10 + i * 5]! << 8) | p[11 + i * 5]!, (p[12 + i * 5]! << 8) | p[13 + i * 5]!];
      return this.reply(h);
    }
    return this.reply([0xff]);
  }
}

// ---- Guard ------------------------------------------------------------------------------------------

export type MadGuard = { ok: true; cls: 'query' | 'write'; label: string } | { ok: false; reason: string };

const zeroFrom = (p: Uint8Array, i: number) => p.subarray(i).every((b) => b === 0);
const u16 = (p: Uint8Array, i: number) => ((p[i] ?? 0) << 8) | (p[i + 1] ?? 0);
const inTravel = (raw: number) => raw >= 5 && raw <= 340;

export function checkMad(p: Uint8Array): MadGuard {
  if (p.length !== REPORT) return { ok: false, reason: 'report must be 32 bytes' };
  const [cmd, a, sub] = [p[0], p[1], p[2]];
  if (cmd === CMD.PROTOCOL) return zeroFrom(p, 1) ? { ok: true, cls: 'query', label: 'protocol version' } : { ok: false, reason: 'bad protocol query' };
  if (cmd === CMD.CUSTOM_GET && a === SUB.LIGHT) return zeroFrom(p, 2) ? { ok: true, cls: 'query', label: 'read lighting' } : { ok: false, reason: 'bad lighting read' };
  if (cmd === CMD.CUSTOM_SET && a === SUB.LIGHT) {
    const ok = MAD_EFFECTS.some((e) => e.n === p[2]) && p[3] === 0 && (p[4] ?? 0) >= 1 && (p[8] ?? 255) <= BRIGHTNESS_MAX && zeroFrom(p, 9);
    return ok ? { ok: true, cls: 'write', label: `lighting effect ${p[2]}` } : { ok: false, reason: 'lighting values out of range' };
  }
  if (a !== CHANNEL || (cmd !== CMD.GET_VALUE && cmd !== CMD.SET_VALUE)) return { ok: false, reason: `command 0x${(cmd ?? 0).toString(16)} is not on the allow-list` };
  if (cmd === CMD.SET_VALUE && sub === SUB.SAVE_LIGHT) return zeroFrom(p, 3) ? { ok: true, cls: 'write', label: 'save lighting' } : { ok: false, reason: 'bad save-lighting packet' };
  if (sub === SUB.FEATURES) {
    if (cmd === CMD.GET_VALUE) return zeroFrom(p, 3) ? { ok: true, cls: 'query', label: 'read keyboard switches' } : { ok: false, reason: 'bad switches read' };
    const flags = [p[4], p[5], p[6], p[7]].every((b) => b === 0 || b === 1);
    return flags && zeroFrom(p, 8) ? { ok: true, cls: 'write', label: `keyboard switches (${p[5] ? 'Mac' : 'Windows'} layout)` } : { ok: false, reason: 'switch values must be 0 or 1' };
  }
  if (sub === SUB.ADVANCED) return checkAdvanced(p);
  if (p[3] !== 0 || p[4] !== 0) return { ok: false, reason: 'bad bulk header' };
  const off = u16(p, 5);
  const n = p[7] ?? 0;
  if (n < 1 || off + n > TOTAL) return { ok: false, reason: 'bulk range outside the 5×15 matrix' };
  if (cmd === CMD.GET_VALUE) {
    const max = sub === SUB.ACTUATION ? MAX_ACT_READ : sub === SUB.RT ? MAX_RT_READ : sub === SUB.TRAVEL ? MAX_TRAVEL_READ : 0;
    if (!max) return { ok: false, reason: `vendor read 0x${(sub ?? 0).toString(16)} is not on the allow-list` };
    return n <= max && zeroFrom(p, 8) ? { ok: true, cls: 'query', label: `read ${sub === SUB.ACTUATION ? 'actuation' : sub === SUB.RT ? 'rapid trigger' : 'live travel'} @${off}` } : { ok: false, reason: 'bad bulk read' };
  }
  const flash = p[8];
  if (flash !== FLASH.LIVE && flash !== FLASH.PERSIST) return { ok: false, reason: 'flash byte must be 00 or 03' };
  if (sub === SUB.ACTUATION) {
    if (n > MAX_ACT_WRITE) return { ok: false, reason: 'too many actuation values' };
    for (let i = 0; i < n; i++) if (!inTravel(u16(p, 9 + i * 2))) return { ok: false, reason: 'actuation outside 0.05–3.40 mm' };
    return zeroFrom(p, 9 + n * 2) ? { ok: true, cls: 'write', label: `actuation @${off} ×${n}${flash ? ' (save)' : ''}` } : { ok: false, reason: 'bad padding' };
  }
  if (sub === SUB.RT) {
    if (n > MAX_RT_WRITE) return { ok: false, reason: 'too many rapid-trigger values' };
    for (let i = 0; i < n; i++) {
      const o = 9 + i * 5;
      if ((p[o] ?? 9) > 1 || !inTravel(u16(p, o + 1)) || !inTravel(u16(p, o + 3))) return { ok: false, reason: 'rapid trigger values out of range' };
    }
    return zeroFrom(p, 9 + n * 5) ? { ok: true, cls: 'write', label: `rapid trigger @${off} ×${n}${flash ? ' (save)' : ''}` } : { ok: false, reason: 'bad padding' };
  }
  return { ok: false, reason: `vendor write 0x${(sub ?? 0).toString(16)} is not on the allow-list` };
}

const PHYSICAL = new Set(MAD68_LAYOUT.keys.map((k) => k.slot));

function checkAdvanced(p: Uint8Array): MadGuard {
  const idx = p[6] ?? 99;
  if (p[3] !== 0 || p[4] !== 0 || idx >= ADVANCED_SLOTS) return { ok: false, reason: 'bad advanced-key header' };
  if (p[0] === CMD.GET_VALUE) return p[5] === 0x01 && p[7] === idx && zeroFrom(p, 8) ? { ok: true, cls: 'query', label: `read advanced key ${idx}` } : { ok: false, reason: 'bad advanced-key read' };
  if (p[5] !== 0x03) return { ok: false, reason: 'bad advanced-key sub-field' };
  const mode = p[7] ?? 99;
  if (mode === 0) return zeroFrom(p, 8) ? { ok: true, cls: 'write', label: `clear advanced key ${idx}` } : { ok: false, reason: 'a cleared slot must be all zero' };
  if (mode < 2 || mode > 5) return { ok: false, reason: 'only SOCD modes (2–5) can be written' };
  const k1 = (p[13] ?? 99) * COLS + (p[14] ?? 99);
  const k2 = (p[15] ?? 99) * COLS + (p[16] ?? 99);
  const ok = p[8] === 0 && (p[11] ?? 9) <= 1 && (p[12] ?? 9) <= 1 && (p[14] ?? 99) < COLS && (p[16] ?? 99) < COLS && PHYSICAL.has(k1) && PHYSICAL.has(k2) && k1 !== k2 && (p[17] ?? 9) < 4 && zeroFrom(p, 18);
  return ok ? { ok: true, cls: 'write', label: `SOCD pair in slot ${idx} (mode ${mode})` } : { ok: false, reason: 'SOCD slot values out of range' };
}

// ---- Channel ----------------------------------------------------------------------------------------

export interface MadChannelOptions {
  isDryRun: () => boolean;
  allowExperimental: () => boolean;
  log: (e: Omit<LogEntry, 'id' | 't'>) => void;
  beforeFirstWrite?: () => Promise<void>;
}

export class MadChannel {
  readonly board: MadBoard;
  protocol: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private waiter: { match: (d: Uint8Array) => boolean; resolve: (d: Uint8Array) => void } | null = null;
  private wroteOnce = false;
  private unsub: () => void;

  constructor(
    readonly transport: MadTransport,
    private opts: MadChannelOptions,
  ) {
    const b = findMadBoard(transport.productId);
    if (!b) throw new Error(`Unsupported MADLIONS product 0x${transport.productId.toString(16)}`);
    this.board = b;
    this.unsub = transport.onInput((raw) => {
      const d = stripId(raw);
      if (this.waiter?.match(d)) {
        const w = this.waiter;
        this.waiter = null;
        w.resolve(d);
      }
    });
  }

  dispose() {
    this.unsub();
  }

  /** Why writes are refused right now, or null if they are allowed. */
  writeBlock(): string | null {
    if (this.protocol !== KNOWN_PROTOCOL) return `firmware protocol ${this.protocol ?? 'unknown'} is not the verified version ${KNOWN_PROTOCOL}`;
    if (!this.board.verified && !this.opts.allowExperimental()) return `${this.board.name} has not been verified on hardware yet (Settings → Allow experimental writes)`;
    return null;
  }

  request(p: Uint8Array, o: { quiet?: boolean; timeoutMs?: number } = {}): Promise<Uint8Array | null> {
    const run = async () => {
      const v = checkMad(p);
      const hex = toHexTrimmed(p);
      if (!v.ok) {
        this.opts.log({ dir: 'blocked', hex, label: `madlions: ${v.reason}` });
        throw new Error(v.reason);
      }
      const label = `madlions: ${v.label}`;
      if (v.cls === 'write') {
        const block = this.writeBlock();
        if (block) {
          this.opts.log({ dir: 'blocked', hex, label: `${label}: ${block}` });
          throw new Error(block);
        }
        if (this.opts.isDryRun()) {
          this.opts.log({ dir: 'dry', hex, label });
          return null;
        }
        if (!this.wroteOnce) {
          await this.opts.beforeFirstWrite?.();
          this.wroteOnce = true;
        }
      }
      const echo = p[0] === CMD.CUSTOM_GET || p[0] === CMD.CUSTOM_SET ? 2 : p[0] === CMD.PROTOCOL ? 1 : 3;
      const reply = new Promise<Uint8Array | null>((resolve) => {
        const timer = setTimeout(() => ((this.waiter = null), resolve(null)), o.timeoutMs ?? 1000);
        this.waiter = {
          match: (d) => Array.from(p.subarray(0, echo)).every((b, i) => d[i] === b) && (p[0] !== CMD.GET_VALUE || ![SUB.ACTUATION, SUB.RT, SUB.TRAVEL].includes(p[2] as never) || (d[5] === p[5] && d[6] === p[6])),
          resolve: (d) => (clearTimeout(timer), resolve(d)),
        };
      });
      if (!o.quiet) this.opts.log({ dir: 'out', hex, label });
      await this.transport.send(p);
      const d = await reply;
      if (!d) throw new Error(`${v.label}: no reply from the keyboard`);
      if (!o.quiet) this.opts.log({ dir: 'in', hex: toHexTrimmed(d), label: `${label}: ok` });
      return d;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
