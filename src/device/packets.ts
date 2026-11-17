// Packet builders and parsers. Payloads are 63 bytes (the HID report ID 0x04 is added by the transport).
// Byte layouts and sources are documented in docs/PROTOCOL.md.

import { LED_CUSTOM_KEYS_PER_PACKET, LED_LEVEL_MAX, OP, PAYLOAD_SIZE, SLOT_COUNT, TRAVEL_SUB, type TravelKind } from './constants';
import { encodeTarget, type KeyTarget } from './keycodes';
import { firmwareLabel, firmwareNumber, travelRange, type Dialect } from './models';

export type Packet = Uint8Array;

export function packet(...head: number[]): Packet {
  const p = new Uint8Array(PAYLOAD_SIZE);
  p.set(head.map((b) => b & 0xff));
  return p;
}

export const toHex = (p: ArrayLike<number>, max = p.length) =>
  Array.from({ length: Math.min(max, p.length) }, (_, i) => (p[i] ?? 0).toString(16).padStart(2, '0')).join(' ');

/** Hex with trailing zero bytes collapsed, for readable logs. */
export function toHexTrimmed(p: ArrayLike<number>): string {
  let end = p.length;
  while (end > 1 && p[end - 1] === 0) end--;
  return toHex(p, end) + (end < p.length ? ` …(${p.length - end}×00)` : '');
}

// ---- Identity ----------------------------------------------------------------------

export const buildIdentityQuery = () => packet(OP.IDENTITY, 0x02, 0x00);

export interface Identity {
  typeBytes: [number, number, number];
  fwLo: number;
  fwHi: number;
  firmware: number;
  firmwareLabel: string;
  turbo: boolean;
  rapidTrigger: boolean;
  rdt: boolean;
  lastWin: boolean;
  rtMatch: boolean;
  autoMatchMode: number;
  lwReplace: boolean;
  raw: number[];
}

/** Parse an identity reply (input report 4, data without report ID). Returns null if it is not one. */
export function parseIdentity(d: Uint8Array): Identity | null {
  if (d.length < 33 || d[0] !== OP.IDENTITY || d[1] !== 0x02 || d[2] !== 0x00) return null;
  const b = (i: number) => d[i] ?? 0;
  return {
    typeBytes: [b(4), b(5), b(6)],
    fwLo: b(7),
    fwHi: b(8),
    firmware: firmwareNumber(b(7), b(8)),
    firmwareLabel: firmwareLabel(b(7), b(8)),
    turbo: b(15) !== 0,
    rapidTrigger: b(16) !== 0,
    rdt: b(18) !== 0,
    lastWin: b(19) !== 0,
    rtMatch: b(30) !== 0,
    autoMatchMode: b(31),
    lwReplace: b(32) !== 0,
    raw: Array.from(d),
  };
}

// ---- Per-key travel (actuation / RT downstroke / RT upstroke) ------------------------

export function encodeTravel(kind: TravelKind, mm: number, dialect: Dialect): number {
  const r = travelRange(dialect);
  const [lo, hi] = kind === 'actuation' ? [r.apMin, r.apMax] : [r.rtMin, r.rtMax];
  const clamped = Math.max(lo, Math.min(hi, Number.isFinite(mm) ? mm : lo));
  return Math.round(clamped * r.scale);
}

export const decodeTravel = (byte: number, dialect: Dialect) => byte / travelRange(dialect).scale;

/** Three packets: slots 0-58, 59-117, 118-125. `B6 <sub> 00 <chunk> <values…>` */
export function buildTravelPackets(kind: TravelKind, valuesMm: readonly number[], dialect: Dialect): Packet[] {
  if (valuesMm.length !== SLOT_COUNT) throw new Error(`travel: expected ${SLOT_COUNT} values`);
  const enc = valuesMm.map((v) => encodeTravel(kind, v, dialect));
  const out: Packet[] = [];
  for (let chunk = 0; chunk < 3; chunk++) {
    const p = packet(OP.TRAVEL, TRAVEL_SUB[kind], 0x00, chunk);
    const [start, n] = chunk < 2 ? [chunk * 59, 59] : [118, 8];
    for (let k = 0; k < n; k++) p[4 + k] = enc[start + k] ?? 0;
    out.push(p);
  }
  return out;
}

// ---- Global switches -------------------------------------------------------------------

export interface CommonSwitch {
  turbo: boolean;
  rapidTrigger: boolean;
  lastWin: boolean;
  rdt: boolean;
  rtMatch: boolean;
}

/** `B5 00 1E 01 00 00 01 <turbo> <rt> 00 <lw|rdt> <rtMatch>` */
export function buildCommonSwitch(s: CommonSwitch): Packet {
  const lwRdt = (s.lastWin ? 1 : 0) | (s.rdt ? 2 : 0);
  return packet(OP.COMMON_SWITCH, 0x00, 0x1e, 0x01, 0x00, 0x00, 0x01, +s.turbo, +s.rapidTrigger, 0x00, lwRdt, +s.rtMatch);
}

/** `B6 03 <0|1>`: start/stop the live key-depth stream (0xB7 input reports). */
export const buildTracking = (on: boolean) => packet(OP.TRAVEL, TRAVEL_SUB.tracking, on ? 1 : 0);

// ---- Lighting ----------------------------------------------------------------------------

export interface LedMode {
  mode: number;
  speed: number;
  brightness: number;
  /** 0 = rainbow/default, 1..7 = preset colours */
  colour: number;
}

const level = (v: number) => Math.max(0, Math.min(LED_LEVEL_MAX, Math.round(v)));

/** `AE 01 00 00 <mode> <speed> <brightness> <colour>` */
export function buildLedMode(m: LedMode): Packet {
  return packet(OP.LED, 0x01, 0x00, 0x00, m.mode, level(m.speed), level(m.brightness), Math.max(0, Math.min(7, m.colour)));
}

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Per-key colour stream for the "Custom" effect: fixed packet count (6 for G60/G65, 7 otherwise),
 * each `AE 01 00 00 <customMode> 06 <brightness> FF` + up to 13 × `[0x80+slot, R, G, B]` + `FF`.
 */
export function buildCustomLed(
  slots: readonly number[],
  colours: Readonly<Record<number, string>>,
  brightness: number,
  custom: { code: number; packets: number },
): Packet[] {
  const entries = slots.map((s) => [0x80 + s, ...hexToRgb(colours[s] ?? '#000000')] as number[]);
  if (entries.length > custom.packets * LED_CUSTOM_KEYS_PER_PACKET) throw new Error('custom LED: too many keys');
  const out: Packet[] = [];
  for (let i = 0; i < custom.packets; i++) {
    const p = packet(OP.LED, 0x01, 0x00, 0x00, custom.code, 0x06, level(brightness), 0xff);
    const part = entries.slice(i * LED_CUSTOM_KEYS_PER_PACKET, (i + 1) * LED_CUSTOM_KEYS_PER_PACKET);
    part.forEach((e, k) => p.set(e, 8 + k * 4));
    p[8 + part.length * 4] = 0xff;
    out.push(p);
  }
  return out;
}

// ---- Keymap (experimental) -----------------------------------------------------------------

export const LAYERS = { base: 1, fn1: 2, fn2: 3 } as const;
export type LayerName = keyof typeof LAYERS;

/** 14 packets per layer: `A0 02 04 <pkt 1..14> 0E <layer>` + 9 × `[slot, 5-byte target]` + `A5` at byte 60. */
export function buildKeymapLayer(layer: number, targets: ReadonlyMap<number, KeyTarget>): Packet[] {
  const out: Packet[] = [];
  for (let p = 1; p <= 14; p++) {
    const b = packet(OP.IDENTITY, 0x02, 0x04, p, 0x0e, layer);
    for (let w = 0; w < 9; w++) {
      const slot = (p - 1) * 9 + w;
      const t = targets.get(slot);
      if (!t) continue;
      b[6 + w * 6] = slot;
      b.set(encodeTarget(t), 7 + w * 6);
    }
    b[60] = 0xa5;
    out.push(b);
  }
  return out;
}

// ---- Last Win / Release Dual-Trigger (experimental) -------------------------------------------

export const buildClearPairs = (mode: number) => packet(OP.PAIRS, 0x0a, mode & 3);

/** `FC 01 00 <count>` + `[main, trigger, 0, 0]` per directed pair (max 14). */
export function buildLastWinPairs(pairs: readonly [number, number][]): Packet {
  const list = pairs.slice(0, 14);
  const p = packet(OP.PAIRS, 0x01, 0x00, list.length);
  list.forEach(([a, b], i) => p.set([a, b, 0, 0], 4 + i * 4));
  return p;
}

/** `FC 03 <count>` + `[press, release, activeLo, activeHi, resetLo, resetHi, 0, 0]` per pair; thresholds mm × 200. */
export function buildRdtPairs(pairs: readonly [number, number][], activeMm = 0.1, resetMm = 2.0): Packet {
  const list = pairs.slice(0, 7);
  const a = Math.max(10, Math.min(50, Math.round(activeMm * 200)));
  const r = Math.max(300, Math.min(500, Math.round(resetMm * 200)));
  const p = packet(OP.PAIRS, 0x03, list.length);
  list.forEach(([press, release], i) => p.set([press, release, a & 255, a >> 8, r & 255, r >> 8, 0, 0], 3 + i * 8));
  return p;
}

// ---- Knob (experimental) ----------------------------------------------------------------------

/** `C1 03 <event 1..6> <bind> 00 <target…>` */
export function buildKnobBinding(event: number, target: KeyTarget | null): Packet {
  const p = packet(OP.KNOB, 0x03, event, target ? 1 : 0, 0);
  if (target) {
    p[5] = target.cmd;
    if (target.type === 0) p[7] = target.code;
    else if (target.type === 1 || target.type === 2) p[6] = target.code;
  }
  return p;
}

// ---- Keystroke tracking stream -------------------------------------------------------------------

/** `B7 ?? ?? <chunk> <depth bytes…>`; chunk 0 = slots 0-58, 1 = 59-117, 2 = 118-125. */
export function parseTracking(d: Uint8Array, dialect: Dialect): { slot: number; mm: number }[] | null {
  if (d[0] !== OP.TRACKING_STREAM) return null;
  const chunk = d[3] ?? 0;
  if (chunk > 2) return null;
  const [start, n] = chunk < 2 ? [chunk * 59, 59] : [118, 8];
  const scale = travelRange(dialect).scale;
  const deadZone = dialect === 'oldHighPrec' ? 20 : 2;
  const out: { slot: number; mm: number }[] = [];
  for (let k = 0; k < n; k++) {
    const raw = d[4 + k] ?? 0;
    out.push({ slot: start + k, mm: raw < deadZone ? 0 : raw / scale });
  }
  return out;
}
