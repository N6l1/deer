// Razer mouse control protocol: 90-byte HID feature reports (report ID 0) on USB interface 3.
// Byte layouts follow OpenRazer (GPL-2.0, facts only, code is original) and the Viper V4 Pro Synapse
// capture in openrazer/openrazer#2760. See docs/PROTOCOL-RAZER.md.

export const RAZER_VENDOR_ID = 0x1532;
export const REPORT_SIZE = 90;
export const TRANSACTION_ID = 0x1f; // Viper V4 Pro (OpenRazer)

export interface RazerModel {
  name: string;
  productId: number;
  wireless: boolean;
  dpiMin: number;
  dpiMax: number;
  maxStages: number;
  pollRates: number[];
}

export const VIPER_V4_PRO: RazerModel[] = [
  { name: 'Viper V4 Pro', productId: 0x00e5, wireless: false, dpiMin: 100, dpiMax: 50000, maxStages: 5, pollRates: [125, 500, 1000, 2000, 4000, 8000] },
  { name: 'Viper V4 Pro', productId: 0x00e6, wireless: true, dpiMin: 100, dpiMax: 50000, maxStages: 5, pollRates: [125, 500, 1000, 2000, 4000, 8000] },
];

export const findRazerModel = (pid: number) => VIPER_V4_PRO.find((m) => m.productId === pid);

export const STATUS = { NEW: 0x00, BUSY: 0x01, OK: 0x02, FAILURE: 0x03, TIMEOUT: 0x04, NOT_SUPPORTED: 0x05 } as const;
export const STATUS_TEXT: Record<number, string> = { 0: 'new', 1: 'busy', 2: 'ok', 3: 'failure', 4: 'timeout (mouse asleep or off?)', 5: 'not supported' };

// ---- report framing ---------------------------------------------------------------------

/** XOR of bytes 2..87 */
export function crc(r: Uint8Array): number {
  let c = 0;
  for (let i = 2; i < 88; i++) c ^= r[i] ?? 0;
  return c;
}

export function buildReport(cls: number, id: number, size: number, args: number[] = []): Uint8Array {
  if (args.length > 80) throw new Error('razer: too many arguments');
  const r = new Uint8Array(REPORT_SIZE);
  r[0] = 0x00; // status: new request
  r[1] = TRANSACTION_ID;
  // [2..3] remaining packets = 0, [4] protocol type = 0
  r[5] = size;
  r[6] = cls;
  r[7] = id;
  r.set(args.map((a) => a & 0xff), 8);
  r[88] = crc(r);
  return r;
}

export interface RazerResponse {
  status: number;
  transactionId: number;
  size: number;
  cls: number;
  id: number;
  args: Uint8Array;
  crcOk: boolean;
}

/** Accepts the 90-byte report, or 91 bytes with a leading report ID 0 (some browsers include it). */
export function parseReport(buf: Uint8Array): RazerResponse | null {
  const r = buf.length === REPORT_SIZE + 1 && buf[0] === 0 ? buf.subarray(1) : buf;
  if (r.length < REPORT_SIZE) return null;
  return {
    status: r[0] ?? 0,
    transactionId: r[1] ?? 0,
    size: r[5] ?? 0,
    cls: r[6] ?? 0,
    id: r[7] ?? 0,
    args: r.slice(8, 88),
    crcOk: (r[88] ?? -1) === crc(r),
  };
}

// ---- commands ---------------------------------------------------------------------------------

export const CMD = {
  getFirmware: () => buildReport(0x00, 0x81, 0x02),
  getSerial: () => buildReport(0x00, 0x82, 0x16),
  getPollRate: () => buildReport(0x00, 0xc0, 0x01),
  getDpi: () => buildReport(0x04, 0x85, 0x07, [0x00]),
  getStages: () => buildReport(0x04, 0x86, 0x26, [0x01]),
  getBattery: () => buildReport(0x07, 0x80, 0x02),
  getCharging: () => buildReport(0x07, 0x84, 0x02),
  getIdle: () => buildReport(0x07, 0x83, 0x02),
  getLowBattery: () => buildReport(0x07, 0x81, 0x01),
};

export const POLL_CODES: Record<number, number> = { 8000: 0x01, 4000: 0x02, 2000: 0x04, 1000: 0x08, 500: 0x10, 125: 0x40 };
export const pollFromCode = (c: number) => Number(Object.entries(POLL_CODES).find(([, v]) => v === c)?.[0] ?? 0) || null;

/** OpenRazer sends the HyperPolling write twice for this mouse: once with arg 0x00, once with 0x01. */
export function buildSetPollRate(hz: number): Uint8Array[] {
  const code = POLL_CODES[hz];
  if (code === undefined) throw new Error(`razer: unsupported polling rate ${hz}`);
  return [buildReport(0x00, 0x40, 0x02, [0x00, code]), buildReport(0x00, 0x40, 0x02, [0x01, code])];
}

export interface DpiStage {
  /** stage number as the mouse reports it */
  id: number;
  x: number;
  y: number;
}

/** `04 06`: varstore 01, active stage (1-based), count, then [id, xHi, xLo, yHi, yLo, 0, 0] per stage. */
export function buildSetStages(stages: DpiStage[], active: number, model: RazerModel): Uint8Array {
  if (stages.length < 1 || stages.length > model.maxStages) throw new Error(`razer: 1..${model.maxStages} DPI stages`);
  if (active < 1 || active > stages.length) throw new Error('razer: active stage out of range');
  const clampDpi = (v: number) => Math.max(model.dpiMin, Math.min(model.dpiMax, Math.round(v)));
  const args = [0x01, active, stages.length];
  for (const s of stages) {
    const x = clampDpi(s.x);
    const y = clampDpi(s.y);
    args.push(s.id & 0xff, x >> 8, x & 0xff, y >> 8, y & 0xff, 0, 0);
  }
  return buildReport(0x04, 0x06, 0x26, args);
}

/** Sleep timer in seconds, 60..900 (OpenRazer clamp). */
export function buildSetIdle(seconds: number): Uint8Array {
  const s = Math.max(60, Math.min(900, Math.round(seconds)));
  return buildReport(0x07, 0x03, 0x02, [s >> 8, s & 0xff]);
}

/** Low-battery warning threshold on a 0..255 scale, kept to OpenRazer's 0x0C..0x3F (about 5–25 %). */
export function buildSetLowBattery(raw: number): Uint8Array {
  return buildReport(0x07, 0x01, 0x01, [Math.max(0x0c, Math.min(0x3f, Math.round(raw)))]);
}

// ---- decoders ----------------------------------------------------------------------------------

export const decodeFirmware = (a: Uint8Array) => `v${a[0] ?? 0}.${a[1] ?? 0}`;
export const decodeSerial = (a: Uint8Array) => String.fromCharCode(...Array.from(a.subarray(0, 22)).filter((c) => c >= 0x20 && c < 0x7f)).trim();
export const decodeBattery = (a: Uint8Array) => Math.round(((a[1] ?? 0) / 255) * 100);
export const decodeCharging = (a: Uint8Array) => (a[1] ?? 0) !== 0;
export const decodeIdle = (a: Uint8Array) => ((a[0] ?? 0) << 8) | (a[1] ?? 0);
export const decodeLowBattery = (a: Uint8Array) => a[0] ?? 0;
export const decodePollRate = (a: Uint8Array) => pollFromCode(a[1] ?? 0);
export const decodeDpi = (a: Uint8Array) => ({ x: ((a[1] ?? 0) << 8) | (a[2] ?? 0), y: ((a[3] ?? 0) << 8) | (a[4] ?? 0) });

export function decodeStages(a: Uint8Array): { active: number; stages: DpiStage[] } {
  const active = a[1] ?? 1;
  const count = Math.min(5, a[2] ?? 0);
  const stages: DpiStage[] = [];
  for (let i = 0; i < count; i++) {
    const o = 3 + i * 7;
    stages.push({ id: a[o] ?? i + 1, x: ((a[o + 1] ?? 0) << 8) | (a[o + 2] ?? 0), y: ((a[o + 3] ?? 0) << 8) | (a[o + 4] ?? 0) });
  }
  return { active, stages };
}

export const lowBatteryPercent = (raw: number) => Math.round((raw / 255) * 100);
export const lowBatteryRaw = (pct: number) => Math.round((pct / 100) * 255);
