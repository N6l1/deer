// Logitech HID++ 2.0 over long reports (report ID 0x11, 20 bytes) on the vendor interface (usage page 0xFF00).
// Facts from Solaar (GPL-2.0, facts only, code is original) and kazehana99k's PRO X2 SUPERSTRIKE notes.
// See docs/PROTOCOL-LOGITECH.md.

export const LOGI_VENDOR_ID = 0x046d;
export const LONG_REPORT_ID = 0x11;
export const LONG_PAYLOAD = 19; // bytes after the report ID
export const SWID = 0x0a; // our software ID (low nibble); device notifications use 0
export const HIDPP_USAGE_PAGE = 0xff00;

export interface LogiModel {
  name: string;
  productId: number;
  /** device index: 0x01 behind the LIGHTSPEED receiver, 0xFF when wired */
  deviceIndex: number;
  wireless: boolean;
}

export const PRO_X2_SUPERSTRIKE: LogiModel[] = [
  { name: 'PRO X2 SUPERSTRIKE', productId: 0xc54d, deviceIndex: 0x01, wireless: true }, // LIGHTSPEED receiver
  { name: 'PRO X2 SUPERSTRIKE', productId: 0xc0a8, deviceIndex: 0xff, wireless: false }, // USB cable (Solaar usbid C0A8)
];
export const findLogiModel = (pid: number) => PRO_X2_SUPERSTRIKE.find((m) => m.productId === pid);

export const FEATURE = {
  ROOT: 0x0000,
  DEVICE_NAME: 0x0005,
  UNIFIED_BATTERY: 0x1004,
  SUPERSTRIKE_TUNING: 0x1b0c,
  EXTENDED_DPI: 0x2202,
  EXTENDED_REPORT_RATE: 0x8061,
  ONBOARD_PROFILES: 0x8100,
} as const;
export type FeatureName = keyof typeof FEATURE;

export const HIDPP_ERRORS: Record<number, string> = {
  1: 'unknown', 2: 'invalid argument', 3: 'out of range', 4: 'hardware error', 5: 'internal error',
  6: 'invalid feature index', 7: 'invalid function', 8: 'busy (close Logitech G HUB)', 9: 'unsupported',
};

/** 19-byte long-report payload: [deviceIndex, featureIndex, fn<<4 | swid, params…16] */
export function buildRequest(deviceIndex: number, featureIndex: number, fn: number, params: number[] = []): Uint8Array {
  if (params.length > 16) throw new Error('hid++: too many params');
  const p = new Uint8Array(LONG_PAYLOAD);
  p[0] = deviceIndex;
  p[1] = featureIndex;
  p[2] = ((fn & 0x0f) << 4) | SWID;
  p.set(params.map((b) => b & 0xff), 3);
  return p;
}

export type HidppReply =
  | { kind: 'ok'; deviceIndex: number; featureIndex: number; fn: number; swid: number; params: Uint8Array }
  | { kind: 'error'; deviceIndex: number; featureIndex: number; fn: number; swid: number; code: number };

/** Parse an input report 0x11 (data without the report ID). */
export function parseReply(d: Uint8Array): HidppReply | null {
  if (d.length < 4) return null;
  const [dev, feat, fnsw] = [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
  if (feat === 0xff) {
    const f = d[3] ?? 0;
    return { kind: 'error', deviceIndex: dev, featureIndex: d[2] ?? 0, fn: f >> 4, swid: f & 0x0f, code: d[4] ?? 0 };
  }
  return { kind: 'ok', deviceIndex: dev, featureIndex: feat, fn: fnsw >> 4, swid: fnsw & 0x0f, params: d.slice(3) };
}

// ---- feature-specific helpers ------------------------------------------------------------------

/** IRoot.getFeature(featureId) → index (0 = not supported) */
export const buildGetFeature = (dev: number, featureId: number) => buildRequest(dev, 0x00, 0, [featureId >> 8, featureId & 0xff]);

export interface HitsCaps {
  buttons: number;
  maxActuation: number;
  maxRapidTrigger: number;
  maxHaptics: number;
}

/** 0x1B0C fn0 reply `[flags, buttons, maxAct<<2, maxRt<<2, maxHaptics<<2]`. Only L/R are user-accessible (Solaar). */
export function decodeHitsCaps(p: Uint8Array): HitsCaps {
  const lvl = (b: number | undefined, fallback: number) => (b ? b >> 2 : fallback);
  return { buttons: Math.min(p[1] ?? 2, 2), maxActuation: lvl(p[2], 10), maxRapidTrigger: lvl(p[3], 5), maxHaptics: lvl(p[4], 5) };
}

export interface HitsButton {
  /** 1 = shallowest … maxActuation = deepest */
  actuation: number;
  /** 1 … maxRapidTrigger */
  rapidTrigger: number;
  /** 0 = off … maxHaptics */
  haptics: number;
  /** firmware-managed bit 0 of the rapid-trigger byte; must be written back unchanged */
  rtFlag: number;
}

/** 0x1B0C fn2 reply `[button, act<<2, rt<<2|flag, haptics<<2]` */
export function decodeHitsButton(p: Uint8Array): HitsButton {
  const rt = p[2] ?? 0;
  return { actuation: (p[1] ?? 0) >> 2, rapidTrigger: rt >> 2, haptics: (p[3] ?? 0) >> 2, rtFlag: rt & 0x01 };
}

/** 0x1B0C fn1 params `[button, act<<2, rt<<2|flag, haptics<<2]` with values clamped to the device caps. */
export function encodeHitsButton(button: number, b: HitsButton, caps: HitsCaps): number[] {
  const c = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  return [button, c(b.actuation, 1, caps.maxActuation) << 2, (c(b.rapidTrigger, 1, caps.maxRapidTrigger) << 2) | (b.rtFlag & 1), c(b.haptics, 0, caps.maxHaptics) << 2];
}

/** 0x1004 fn1 reply `[percent, levelFlags, status]` */
export function decodeBattery(p: Uint8Array): { percent: number | null; charging: boolean; full: boolean } {
  const level = p[1] ?? 0;
  const approx = level & 8 ? 90 : level & 4 ? 60 : level & 2 ? 20 : level & 1 ? 5 : 0;
  const status = p[2] ?? 0;
  return { percent: p[0] || approx || null, charging: status === 1 || status === 2 || status === 4, full: status === 3 };
}

/** 0x2202 fn5 reply `[sensor, xHi, xLo, …, yHi, yLo, …, lod]` (Solaar `dpi_extended`) */
export const decodeDpi = (p: Uint8Array) => ({ x: ((p[1] ?? 0) << 8) | (p[2] ?? 0), y: ((p[5] ?? 0) << 8) | (p[6] ?? 0) });

/** 0x8061 fn2 reply `[index]`; index 0..6 = 125, 250, 500, 1000, 2000, 4000, 8000 Hz */
export const decodeReportRate = (p: Uint8Array) => ((p[0] ?? 255) <= 6 ? 125 * 2 ** (p[0] ?? 0) : null);

/** 0x8100 fn2 reply `[mode]`: 1 = onboard profile, 2 = host (software) mode */
export const decodeOnboardMode = (p: Uint8Array) => (p[0] === 1 ? 'onboard' : p[0] === 2 ? 'host' : 'unknown');

/** 0x0005: fn0 → [length], fn1(offset) → ASCII chunk */
export const decodeNameChunk = (p: Uint8Array) => String.fromCharCode(...Array.from(p).filter((c) => c >= 0x20 && c < 0x7f));
