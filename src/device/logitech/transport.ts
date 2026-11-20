// HID++ transports (WebHID + mock), the allow-list guard, and the guarded channel.

import {
  buildRequest, findLogiModel, FEATURE, HIDPP_ERRORS, HIDPP_USAGE_PAGE, LOGI_VENDOR_ID, LONG_PAYLOAD, LONG_REPORT_ID, parseReply,
  LOGI_MODELS, SWID, type FeatureName, type HitsCaps, type LogiModel,
} from './hidpp';
import { toHexTrimmed } from '../packets';
import type { LogEntry } from '../transport';

export interface HidppTransport {
  readonly kind: 'webhid' | 'mock' | string;
  readonly productId: number;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  send(payload: Uint8Array): Promise<void>;
  onInput(listener: (data: Uint8Array) => void): () => void;
  onDisconnect(listener: () => void): () => void;
}

// ---- WebHID -------------------------------------------------------------------------------------

const isHidpp = (d: HIDDevice) => d.collections.some((c) => c.usagePage === HIDPP_USAGE_PAGE && (c.outputReports ?? []).some((r) => r.reportId === LONG_REPORT_ID));

export class WebHidHidppTransport implements HidppTransport {
  readonly kind = 'webhid';
  constructor(private device: HIDDevice) {}
  get productId() {
    return this.device.productId;
  }
  get productName() {
    return this.device.productName;
  }
  static filters(): HIDDeviceFilter[] {
    return LOGI_MODELS.map((m) => ({ vendorId: LOGI_VENDOR_ID, productId: m.productId, usagePage: HIDPP_USAGE_PAGE }));
  }
  static fromPicked(list: HIDDevice[]): WebHidHidppTransport | null {
    const d = list.find((x) => x.vendorId === LOGI_VENDOR_ID && isHidpp(x));
    return d ? new WebHidHidppTransport(d) : null;
  }
  async open() {
    if (!this.device.opened) await this.device.open();
  }
  async close() {
    if (this.device.opened) await this.device.close();
  }
  async send(payload: Uint8Array) {
    await this.device.sendReport(LONG_REPORT_ID, payload as BufferSource);
  }
  onInput(listener: (d: Uint8Array) => void) {
    const h = (e: HIDInputReportEvent) => e.reportId === LONG_REPORT_ID && listener(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
    this.device.addEventListener('inputreport', h);
    return () => this.device.removeEventListener('inputreport', h);
  }
  onDisconnect(listener: () => void) {
    const h = (e: HIDConnectionEvent) => e.device === this.device && listener();
    navigator.hid.addEventListener('disconnect', h);
    return () => navigator.hid.removeEventListener('disconnect', h);
  }
}

// ---- Mock ---------------------------------------------------------------------------------------

/**
 * Simulated Logitech mouse behind the LIGHTSPEED receiver. `superstrike` adds the 0x1B0C click tuning;
 * otherwise it behaves like a PRO X SUPERLIGHT 2 (Solaar dump: 2202 @9, 8061 @11, 8100 @12).
 * Like the real mice, report-rate writes are ignored while an onboard profile is active.
 */
export class MockSuperstrike implements HidppTransport {
  readonly kind = 'mock';
  readonly productName: string;
  readonly sent: Uint8Array[] = [];
  readonly features: Record<number, number>;
  readonly name: string;
  hits = [
    [0x14, 0x0d, 0x0c],
    [0x14, 0x0d, 0x0c],
  ];
  rate = 3;
  mode = 1;
  profile = 1;
  private subs = new Set<(d: Uint8Array) => void>();
  constructor(
    readonly productId = 0xc54d,
    readonly superstrike = true,
  ) {
    this.features = superstrike ? { 0x0005: 3, 0x1004: 6, 0x2202: 9, 0x1b0c: 12, 0x8061: 13, 0x8100: 14 } : { 0x0005: 3, 0x1004: 6, 0x2202: 9, 0x8061: 11, 0x8100: 12 };
    this.name = superstrike ? 'PRO X2 SUPERSTRIKE' : 'PRO X 2';
    this.productName = `DeerTune Mock ${superstrike ? 'PRO X2 SUPERSTRIKE' : 'PRO X SUPERLIGHT 2'}`;
  }
  async open() {}
  async close() {}
  onDisconnect() {
    return () => undefined;
  }
  onInput(l: (d: Uint8Array) => void) {
    this.subs.add(l);
    return () => void this.subs.delete(l);
  }
  async send(p: Uint8Array) {
    this.sent.push(p.slice());
    const [dev, feat, fnsw] = [p[0]!, p[1]!, p[2]!];
    const fn = fnsw >> 4;
    const reply = (params: number[]) => {
      const r = new Uint8Array(LONG_PAYLOAD);
      r.set([dev, feat, fnsw, ...params]);
      queueMicrotask(() => this.subs.forEach((l) => l(r)));
    };
    const error = (code: number) => {
      const r = new Uint8Array(LONG_PAYLOAD);
      r.set([dev, 0xff, feat, fnsw, code]);
      queueMicrotask(() => this.subs.forEach((l) => l(r)));
    };
    const id = Number(Object.entries(this.features).find(([, i]) => i === feat)?.[0] ?? -1);
    if (feat === 0 && fn === 0) return reply([this.features[(p[3]! << 8) | p[4]!] ?? 0, 0, 0]);
    const name = this.name;
    if (id === 0x0005 && fn === 0) return reply([name.length]);
    if (id === 0x0005 && fn === 1) return reply([...name.slice(p[3]!, p[3]! + 16)].map((c) => c.charCodeAt(0)));
    if (id === 0x1004 && fn === 1) return reply([82, 0x04, 0x00]);
    if (id === 0x2202 && fn === 5) return reply([0, 0x03, 0x20, 0, 0, 0x03, 0x20, 0, 0, 2]);
    if (id === 0x8061 && fn === 1) return reply([0x00, 0x7f]);
    if (id === 0x8061 && fn === 2) return reply([this.rate]);
    if (id === 0x8061 && fn === 3) {
      if (this.mode === 2) this.rate = p[3]!;
      return reply([]);
    }
    if (id === 0x8100 && fn === 2) return reply([this.mode]);
    if (id === 0x8100 && fn === 4) return reply([0, this.profile]);
    if (id === 0x8100 && fn === 1) {
      this.mode = p[3]!;
      if (this.mode === 1) this.rate = 3; // the onboard profile's own rate comes back
      return reply([]);
    }
    if (id === 0x8100 && fn === 3) {
      this.profile = p[4]!;
      return reply([]);
    }
    if (this.superstrike && id === 0x1b0c && fn === 0) return reply([0x00, 0x03, 0x28, 0x14, 0x14, 0x01]);
    if (this.superstrike && id === 0x1b0c && fn === 2) return reply([p[3]!, ...this.hits[p[3]!]!]);
    if (this.superstrike && id === 0x1b0c && fn === 1) {
      this.hits[p[3]!] = [p[4]!, p[5]!, p[6]!];
      return reply([p[3]!, p[4]!, p[5]!, p[6]!]);
    }
    return error(7);
  }
}

// ---- Guard --------------------------------------------------------------------------------------

export type HidppClass = 'query' | 'write';
export type HidppGuardResult = { ok: true; cls: HidppClass; label: string } | { ok: false; reason: string };

/** feature → allowed functions. Every other feature (reset, pairing, OOB state, profile writes…) is refused. */
const READS: Partial<Record<FeatureName, Record<number, string>>> = {
  DEVICE_NAME: { 0: 'name length', 1: 'name' },
  UNIFIED_BATTERY: { 0: 'battery capabilities', 1: 'battery status' },
  SUPERSTRIKE_TUNING: { 0: 'click tuning capabilities', 2: 'click tuning' },
  EXTENDED_DPI: { 5: 'DPI' },
  EXTENDED_REPORT_RATE: { 1: 'supported report rates', 2: 'report rate' },
  ONBOARD_PROFILES: { 2: 'onboard mode', 4: 'active onboard profile' },
};

export function checkHidpp(p: Uint8Array, dev: number, featureIndex: Partial<Record<FeatureName, number>>, caps: HitsCaps | null): HidppGuardResult {
  if (p.length !== LONG_PAYLOAD) return { ok: false, reason: 'payload must be 19 bytes' };
  if (p[0] !== dev) return { ok: false, reason: 'wrong device index' };
  if (((p[2] ?? 0) & 0x0f) !== SWID) return { ok: false, reason: 'wrong software ID' };
  const fn = (p[2] ?? 0) >> 4;
  const idx = p[1] ?? 0;
  const params = p.subarray(3);
  if (idx === 0 && fn === 0) {
    const id = ((params[0] ?? 0) << 8) | (params[1] ?? 0);
    return Object.values(FEATURE).includes(id as never) && params.subarray(2).every((b) => b === 0)
      ? { ok: true, cls: 'query', label: `find feature 0x${id.toString(16).padStart(4, '0')}` }
      : { ok: false, reason: `feature 0x${id.toString(16)} is not on the allow-list` };
  }
  const name = (Object.keys(featureIndex) as FeatureName[]).find((k) => featureIndex[k] === idx && idx !== 0);
  if (!name) return { ok: false, reason: `feature index ${idx} is not on the allow-list` };
  const read = READS[name]?.[fn];
  if (read) return { ok: true, cls: 'query', label: read };
  if (name === 'SUPERSTRIKE_TUNING' && fn === 1) {
    if (!caps) return { ok: false, reason: 'click tuning capabilities not read yet' };
    const [btn, act, rt, hap] = [params[0] ?? 9, params[1] ?? 0, params[2] ?? 0, params[3] ?? 0];
    const ok =
      btn < caps.buttons &&
      (act & 3) === 0 && act >> 2 >= 1 && act >> 2 <= caps.maxActuation &&
      (rt & 2) === 0 && rt >> 2 >= 1 && rt >> 2 <= caps.maxRapidTrigger &&
      (hap & 3) === 0 && hap >> 2 <= caps.maxHaptics &&
      params.subarray(4).every((b) => b === 0);
    return ok ? { ok: true, cls: 'write', label: `click tuning (${btn === 0 ? 'left' : 'right'})` } : { ok: false, reason: 'click tuning values out of range' };
  }
  if (name === 'EXTENDED_REPORT_RATE' && fn === 3) {
    return (params[0] ?? 99) <= 6 && params.subarray(1).every((b) => b === 0)
      ? { ok: true, cls: 'write', label: `report rate ${125 * 2 ** (params[0] ?? 0)} Hz` }
      : { ok: false, reason: 'report rate index must be 0..6' };
  }
  if (name === 'ONBOARD_PROFILES' && fn === 1) {
    return (params[0] === 1 || params[0] === 2) && params.subarray(1).every((b) => b === 0)
      ? { ok: true, cls: 'write', label: params[0] === 2 ? 'switch to software (host) mode' : 'switch to onboard profiles' }
      : { ok: false, reason: 'onboard mode must be 1 (onboard) or 2 (host)' };
  }
  if (name === 'ONBOARD_PROFILES' && fn === 3) {
    const prof = ((params[0] ?? 0) << 8) | (params[1] ?? 0);
    return prof >= 1 && prof <= 5 && params.subarray(2).every((b) => b === 0)
      ? { ok: true, cls: 'write', label: `activate onboard profile ${prof}` }
      : { ok: false, reason: 'onboard profile must be 1..5' };
  }
  return { ok: false, reason: `${name} function ${fn} is not on the allow-list` };
}

// ---- Channel ------------------------------------------------------------------------------------

export interface HidppChannelOptions {
  isDryRun: () => boolean;
  log: (e: Omit<LogEntry, 'id' | 't'>) => void;
  beforeFirstWrite?: () => Promise<void>;
}

export class HidppError extends Error {}

export class HidppChannel {
  readonly model: LogiModel;
  dev: number;
  readonly features: Partial<Record<FeatureName, number>> = { ROOT: 0 };
  caps: HitsCaps | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private waiter: { match: (d: Uint8Array) => boolean; resolve: (d: Uint8Array) => void } | null = null;
  private wroteOnce = false;
  private unsub: () => void;

  constructor(
    readonly transport: HidppTransport,
    private opts: HidppChannelOptions,
  ) {
    const m = findLogiModel(transport.productId);
    if (!m) throw new Error(`Unsupported Logitech product 0x${transport.productId.toString(16)}`);
    this.model = m;
    this.dev = m.deviceIndex;
    this.unsub = transport.onInput((d) => {
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

  /** Send one request and wait for its reply (matched on device, feature, function and our software ID). */
  request(p: Uint8Array, timeoutMs = 1500): Promise<Uint8Array | null> {
    const run = async () => {
      const v = checkHidpp(p, this.dev, this.features, this.caps);
      const hex = toHexTrimmed(p);
      if (!v.ok) {
        this.opts.log({ dir: 'blocked', hex, label: `logitech: ${v.reason}` });
        throw new HidppError(v.reason);
      }
      const label = `logitech: ${v.label}`;
      if (v.cls === 'write' && this.opts.isDryRun()) {
        this.opts.log({ dir: 'dry', hex, label });
        return null;
      }
      if (v.cls === 'write' && !this.wroteOnce) {
        await this.opts.beforeFirstWrite?.();
        this.wroteOnce = true;
      }
      const reply = new Promise<Uint8Array | null>((resolve) => {
        const timer = setTimeout(() => ((this.waiter = null), resolve(null)), timeoutMs);
        this.waiter = {
          match: (d) => d[0] === p[0] && ((d[1] === p[1] && d[2] === p[2]) || (d[1] === 0xff && d[2] === p[1] && d[3] === p[2])),
          resolve: (d) => (clearTimeout(timer), resolve(d)),
        };
      });
      this.opts.log({ dir: 'out', hex, label });
      await this.transport.send(p);
      const d = await reply;
      if (!d) throw new HidppError(`${v.label}: no reply (is the mouse on and is G HUB closed?)`);
      const r = parseReply(d)!;
      this.opts.log({ dir: 'in', hex: toHexTrimmed(d), label: `${label}: ${r.kind === 'ok' ? 'ok' : HIDPP_ERRORS[r.code] ?? r.code}` });
      if (r.kind === 'error') throw new HidppError(`${v.label}: ${HIDPP_ERRORS[r.code] ?? `error ${r.code}`}`);
      return r.params;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Look up feature indexes via IRoot. Wired devices that don't answer on 0xFF are retried behind index 1. */
  async discover(): Promise<void> {
    for (const name of Object.keys(FEATURE) as FeatureName[]) {
      if (name === 'ROOT') continue;
      const id = FEATURE[name];
      let res: Uint8Array | null = null;
      try {
        res = await this.request(buildRequest(this.dev, 0x00, 0, [id >> 8, id & 0xff]));
      } catch (e) {
        if (name === 'DEVICE_NAME' && this.dev === 0xff) {
          this.dev = 0x01;
          res = await this.request(buildRequest(this.dev, 0x00, 0, [id >> 8, id & 0xff]));
        } else throw e;
      }
      const idx = res?.[0] ?? 0;
      if (idx) this.features[name] = idx;
    }
  }

  idx(name: FeatureName): number | undefined {
    return this.features[name];
  }
}
