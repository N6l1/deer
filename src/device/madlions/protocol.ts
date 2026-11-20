// MADLIONS / FGG Hall-effect keyboards: 32-byte VIA-style reports (no report ID) on the vendor collection
// usage page 0xFF60 / usage 0x61, plus MADLIONS vendor sub-commands on channel 0x96.
// Facts from madlions-control (MIT, hardware-verified on a MAD68 HE RGB 373B:1058, protocol 9).
// See docs/PROTOCOL-MADLIONS.md.

import type { KeyCap, Layout } from '../layouts';

export const MAD_VENDOR_ID = 0x373b;
export const MAD_USAGE_PAGE = 0xff60;
export const MAD_USAGE = 0x61;
export const REPORT = 32;
export const KNOWN_PROTOCOL = 9;

export const CMD = { PROTOCOL: 0x01, GET_VALUE: 0x02, SET_VALUE: 0x03, CUSTOM_SET: 0x07, CUSTOM_GET: 0x08 } as const;
export const CHANNEL = 0x96;
export const SUB = { ACTUATION: 0x0d, RT: 0x0e, SAVE_LIGHT: 0x12, TRAVEL: 0x17, LIGHT: 0x41 } as const;
export const FLASH = { LIVE: 0x00, PERSIST: 0x03 } as const;

export const ROWS = 5;
export const COLS = 15;
export const TOTAL = ROWS * COLS; // 75 matrix cells, 68 keys
export const TRAVEL_MIN = 0.05;
export const TRAVEL_MAX = 3.4;
export const BRIGHTNESS_MAX = 210;

export const MAX_ACT_READ = 12;
export const MAX_ACT_WRITE = 11;
export const MAX_RT_READ = 4;
export const MAX_RT_WRITE = 4;
export const MAX_TRAVEL_READ = 12;

export interface MadBoard {
  productId: number;
  name: string;
  /** driven with writes and read-back on real hardware by madlions-control */
  verified: boolean;
}

export const MAD68_BOARDS: MadBoard[] = [
  { productId: 0x1058, name: 'MAD68 HE RGB', verified: true },
  { productId: 0x1057, name: 'MAD68 HE', verified: false },
  { productId: 0x1059, name: 'MAD68 HE Ultra', verified: false },
  { productId: 0x105a, name: 'MAD68 HE Limited', verified: false },
  { productId: 0x105c, name: 'MAD68 HE Limited', verified: false },
];
export const findMadBoard = (pid: number) => MAD68_BOARDS.find((b) => b.productId === pid);

// ---- layout (65 %, 16 units wide; slot = row * 15 + col) -----------------------------------------

type R = [col: number, w: number, label: string][];
const ROWS_65: R[] = [
  [[0, 1, 'Esc'], [1, 1, '1'], [2, 1, '2'], [3, 1, '3'], [4, 1, '4'], [5, 1, '5'], [6, 1, '6'], [7, 1, '7'], [8, 1, '8'], [9, 1, '9'], [10, 1, '0'], [11, 1, '-'], [12, 1, '='], [13, 2, 'Backspace'], [14, 1, 'Ins']],
  [[0, 1.5, 'Tab'], [1, 1, 'Q'], [2, 1, 'W'], [3, 1, 'E'], [4, 1, 'R'], [5, 1, 'T'], [6, 1, 'Y'], [7, 1, 'U'], [8, 1, 'I'], [9, 1, 'O'], [10, 1, 'P'], [11, 1, '['], [12, 1, ']'], [13, 1.5, '\\'], [14, 1, 'Del']],
  [[0, 1.75, 'Caps'], [1, 1, 'A'], [2, 1, 'S'], [3, 1, 'D'], [4, 1, 'F'], [5, 1, 'G'], [6, 1, 'H'], [7, 1, 'J'], [8, 1, 'K'], [9, 1, 'L'], [10, 1, ';'], [11, 1, "'"], [13, 2.25, 'Enter'], [14, 1, 'PgUp']],
  [[0, 2.25, 'Shift'], [2, 1, 'Z'], [3, 1, 'X'], [4, 1, 'C'], [5, 1, 'V'], [6, 1, 'B'], [7, 1, 'N'], [8, 1, 'M'], [9, 1, ','], [10, 1, '.'], [11, 1, '/'], [12, 1.75, 'Shift'], [13, 1, '↑'], [14, 1, 'PgDn']],
  [[0, 1.25, 'Ctrl'], [1, 1.25, 'Win'], [2, 1.25, 'Alt'], [6, 6.25, 'Space'], [9, 1, 'Alt'], [10, 1, 'Fn'], [11, 1, 'Ctrl'], [12, 1, '←'], [13, 1, '↓'], [14, 1, '→']],
];

function buildLayout(): Layout {
  const keys: KeyCap[] = [];
  ROWS_65.forEach((row, r) => {
    let x = 0;
    for (const [col, w, label] of row) {
      keys.push({ slot: r * COLS + col, label, x, y: r, w });
      x += w;
    }
  });
  return { keys, width: 16, height: 5, approximate: false };
}
export const MAD68_LAYOUT = buildLayout();
export const MAD68_PRESETS = { wasd: [17, 31, 32, 33] };

// ---- report building ------------------------------------------------------------------------------

export function report(...bytes: number[]): Uint8Array {
  if (bytes.length > REPORT) throw new Error('madlions: report too long');
  const r = new Uint8Array(REPORT);
  r.set(bytes.map((b) => b & 0xff));
  return r;
}

export const mmToRaw = (mm: number) => Math.round(Math.max(TRAVEL_MIN, Math.min(TRAVEL_MAX, mm)) * 100);
export const rawToMm = (raw: number) => Math.round(raw) / 100;

export const buildProtocolQuery = () => report(CMD.PROTOCOL);
export const buildBulkRead = (sub: number, offset: number, count: number) => report(CMD.GET_VALUE, CHANNEL, sub, 0, 0, offset >> 8, offset & 0xff, count);
export const buildReadLight = () => report(CMD.CUSTOM_GET, SUB.LIGHT);
export const buildSaveLight = () => report(CMD.SET_VALUE, CHANNEL, SUB.SAVE_LIGHT);

/** `03 96 0D 00 00 offHi offLo count flash` + u16 BE (0.01 mm) per key, max 11 per packet. */
export function buildActuationWrites(values: number[], flash: number = FLASH.PERSIST): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < values.length; i += MAX_ACT_WRITE) {
    const chunk = values.slice(i, i + MAX_ACT_WRITE);
    const data = chunk.flatMap((mm) => {
      const raw = mmToRaw(mm);
      return [raw >> 8, raw & 0xff];
    });
    out.push(report(CMD.SET_VALUE, CHANNEL, SUB.ACTUATION, 0, 0, i >> 8, i & 0xff, chunk.length, flash, ...data));
  }
  return out;
}

export interface RapidTrigger {
  enabled: boolean;
  /** release (upstroke) sensitivity, mm */
  release: number;
  /** press (downstroke) sensitivity, mm */
  press: number;
}

/** `03 96 0E … flash` + [enabled, release u16, press u16] per key, max 4 per packet. */
export function buildRtWrites(values: RapidTrigger[], flash: number = FLASH.PERSIST): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < values.length; i += MAX_RT_WRITE) {
    const chunk = values.slice(i, i + MAX_RT_WRITE);
    const data = chunk.flatMap((rt) => {
      const [rel, pr] = [mmToRaw(rt.release), mmToRaw(rt.press)];
      return [rt.enabled ? 1 : 0, rel >> 8, rel & 0xff, pr >> 8, pr & 0xff];
    });
    out.push(report(CMD.SET_VALUE, CHANNEL, SUB.RT, 0, 0, i >> 8, i & 0xff, chunk.length, flash, ...data));
  }
  return out;
}

export interface Light {
  effect: number;
  speed: number;
  r: number;
  g: number;
  b: number;
  brightness: number;
}

/** `07 41 effect 00 speed r g b brightness` (brightness above 210 is ignored by the firmware). */
export const buildSetLight = (l: Light) =>
  report(CMD.CUSTOM_SET, SUB.LIGHT, l.effect, 0, Math.max(1, Math.min(255, l.speed)), l.r, l.g, l.b, Math.max(0, Math.min(BRIGHTNESS_MAX, l.brightness)));

/** The firmware ignores colour/brightness while the effect is Off, so stage them with Solid first (madlions-control). */
export function buildLightWrites(l: Light): Uint8Array[] {
  return l.effect === 0 ? [buildSetLight({ ...l, effect: 2 }), buildSetLight(l), buildSaveLight()] : [buildSetLight(l), buildSaveLight()];
}

// ---- reply parsing -------------------------------------------------------------------------------

/** Some firmware builds prefix a report-ID byte. */
export const stripId = (d: Uint8Array) => (d.length > REPORT && d[0] === 0 ? d.subarray(1, 1 + REPORT) : d.subarray(0, REPORT));

export const decodeProtocol = (d: Uint8Array) => ((d[1] ?? 0) << 8) | (d[2] ?? 0);

/** Bulk reply: echoes offset at [5:7] and count at [7]; data from [8]. Returns null if it doesn't match. */
export function bulkData(d: Uint8Array, offset: number, count: number, entry: number): Uint8Array | null {
  if ((((d[5] ?? 0) << 8) | (d[6] ?? 0)) !== offset || d[7] !== count) return null;
  const data = d.subarray(8, 8 + count * entry);
  return data.length === count * entry ? data : null;
}

export const decodeU16s = (data: Uint8Array) => Array.from({ length: data.length / 2 }, (_, i) => ((data[i * 2] ?? 0) << 8) | (data[i * 2 + 1] ?? 0));

export const decodeRts = (data: Uint8Array): RapidTrigger[] =>
  Array.from({ length: data.length / 5 }, (_, i) => {
    const o = i * 5;
    return { enabled: !!data[o], release: rawToMm(((data[o + 1] ?? 0) << 8) | (data[o + 2] ?? 0)), press: rawToMm(((data[o + 3] ?? 0) << 8) | (data[o + 4] ?? 0)) };
  });

export const decodeLight = (d: Uint8Array): Light => ({ effect: d[2] ?? 0, speed: d[4] ?? 128, r: d[5] ?? 255, g: d[6] ?? 255, b: d[7] ?? 255, brightness: d[8] ?? 0 });

/** Vendor configurator's effect table (madlions-control lighting.py). */
export const MAD_EFFECTS: { n: number; name: string; colour: boolean }[] = [
  { n: 0, name: 'Off', colour: false }, { n: 2, name: 'Solid colour', colour: true }, { n: 3, name: 'Focus', colour: true },
  { n: 4, name: 'Rainbow (vertical)', colour: true }, { n: 5, name: 'Rainbow (horizontal)', colour: true }, { n: 6, name: 'Breathing', colour: true },
  { n: 7, name: 'Ribbon 1', colour: true }, { n: 8, name: 'Ribbon 2', colour: true }, { n: 9, name: 'Rotating belt 1', colour: true },
  { n: 11, name: 'Rotating belt 2', colour: true }, { n: 13, name: 'Spectrum cycle', colour: false }, { n: 19, name: 'Colour swirl 1', colour: false },
  { n: 23, name: 'Colour swirl 2', colour: false }, { n: 25, name: 'Christmas', colour: false }, { n: 26, name: 'Spectrum breathing', colour: true },
  { n: 28, name: 'Spectrum floating', colour: true }, { n: 30, name: 'Digital rain', colour: false }, { n: 31, name: 'Lighting up', colour: true },
  { n: 36, name: 'Crucifix', colour: true }, { n: 39, name: 'Fingertip rainbow', colour: false },
];
