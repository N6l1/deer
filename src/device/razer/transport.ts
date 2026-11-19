// Feature-report transports for Razer mice, plus the guarded channel the UI talks to.

import { findRazerModel, parseReport, RAZER_VENDOR_ID, REPORT_SIZE, STATUS, STATUS_TEXT, VIPER_V4_PRO, buildReport, crc, type RazerModel, type RazerResponse } from './protocol';
import { checkRazerReport } from './guard';
import { toHexTrimmed } from '../packets';
import type { LogEntry } from '../transport';

export interface MouseTransport {
  readonly kind: 'webhid' | 'mock' | string;
  readonly productId: number;
  readonly productName: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendFeature(report: Uint8Array): Promise<void>;
  receiveFeature(): Promise<Uint8Array>;
  onDisconnect(listener: () => void): () => void;
}

export class MouseBlockedError extends Error {}

// ---- WebHID ---------------------------------------------------------------------------------------

const featureBytes = (c: HIDCollectionInfo) =>
  (c.featureReports ?? []).filter((r) => (r.reportId ?? 0) === 0).reduce((n, r) => n + (r.items ?? []).reduce((m, i) => m + ((i.reportSize ?? 0) * (i.reportCount ?? 0)) / 8, 0), 0);

/** The HIDDevice entry that carries the 90-byte control report (USB interface 3 on the Viper V4 Pro). */
const isControl = (d: HIDDevice) => d.collections.some((c) => featureBytes(c) === REPORT_SIZE);

export class WebHidMouseTransport implements MouseTransport {
  readonly kind = 'webhid';
  constructor(private device: HIDDevice) {}
  get productId() {
    return this.device.productId;
  }
  get productName() {
    return this.device.productName;
  }

  static filters(): HIDDeviceFilter[] {
    return VIPER_V4_PRO.map((m) => ({ vendorId: RAZER_VENDOR_ID, productId: m.productId }));
  }

  /** Throws a readable error when the browser hides the control interface. */
  static async request(): Promise<WebHidMouseTransport | null> {
    const picked = await navigator.hid.requestDevice({ filters: WebHidMouseTransport.filters() });
    if (!picked.length) return null;
    const control = picked.find(isControl) ?? (await navigator.hid.getDevices()).find((d) => d.vendorId === RAZER_VENDOR_ID && isControl(d));
    if (!control) {
      throw new Error(
        'The browser did not give access to the mouse’s control interface. If the picker showed several "Viper V4 Pro" entries, try again and pick a different one. Otherwise this browser or OS blocks it.',
      );
    }
    return new WebHidMouseTransport(control);
  }

  async open() {
    if (!this.device.opened) await this.device.open();
  }
  async close() {
    if (this.device.opened) await this.device.close();
  }
  async sendFeature(report: Uint8Array) {
    await this.device.sendFeatureReport(0, report as BufferSource);
  }
  async receiveFeature() {
    const v = await this.device.receiveFeatureReport(0);
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  onDisconnect(listener: () => void) {
    const h = (e: HIDConnectionEvent) => e.device === this.device && listener();
    navigator.hid.addEventListener('disconnect', h);
    return () => navigator.hid.removeEventListener('disconnect', h);
  }
}

// ---- Mock -------------------------------------------------------------------------------------------

/** Simulated Viper V4 Pro on its HyperSpeed dongle. */
export class MockRazerMouse implements MouseTransport {
  readonly kind = 'mock';
  readonly productName = 'DeerTune Mock Viper V4 Pro';
  readonly sent: Uint8Array[] = [];
  state = {
    poll: 0x08,
    stages: [
      { id: 1, x: 400, y: 400 },
      { id: 2, x: 800, y: 800 },
      { id: 3, x: 1600, y: 1600 },
      { id: 4, x: 3200, y: 3200 },
    ],
    active: 2,
    idle: 300,
    low: 0x26,
    battery: 0xc8,
    charging: 0,
  };
  private last: Uint8Array | null = null;
  constructor(readonly productId = 0x00e6) {}
  async open() {}
  async close() {}
  async sendFeature(r: Uint8Array) {
    this.sent.push(r.slice());
    this.last = r.slice();
  }
  async receiveFeature() {
    const req = this.last ?? new Uint8Array(REPORT_SIZE);
    const [cls, id] = [req[6], req[7]];
    const out = req.slice();
    out[0] = STATUS.OK;
    const args = (vals: number[]) => {
      out.fill(0, 8, 88);
      out.set(vals, 8);
    };
    const s = this.state;
    const k = `${cls}:${id}`;
    if (k === '0:129') args([1, 2]);
    else if (k === '0:130') args([...'PM2611H0012345'].map((c) => c.charCodeAt(0)));
    else if (k === '0:192') args([0, s.poll]);
    else if (k === '4:133') args([0, s.stages[s.active - 1]!.x >> 8, s.stages[s.active - 1]!.x & 255, s.stages[s.active - 1]!.y >> 8, s.stages[s.active - 1]!.y & 255]);
    else if (k === '4:134') args([1, s.active, s.stages.length, ...s.stages.flatMap((st) => [st.id, st.x >> 8, st.x & 255, st.y >> 8, st.y & 255, 0, 0])]);
    else if (k === '7:128') args([0, s.battery]);
    else if (k === '7:132') args([0, s.charging]);
    else if (k === '7:131') args([s.idle >> 8, s.idle & 255]);
    else if (k === '7:129') args([s.low]);
    else if (k === '0:64') s.poll = req[9] ?? s.poll;
    else if (k === '4:6') {
      const n = req[10] ?? 0;
      s.active = req[9] ?? 1;
      s.stages = Array.from({ length: n }, (_, i) => {
        const o = 11 + i * 7;
        return { id: req[o] ?? i + 1, x: ((req[o + 1] ?? 0) << 8) | (req[o + 2] ?? 0), y: ((req[o + 3] ?? 0) << 8) | (req[o + 4] ?? 0) };
      });
    } else if (k === '7:3') s.idle = ((req[8] ?? 0) << 8) | (req[9] ?? 0);
    else if (k === '7:1') s.low = req[8] ?? s.low;
    else out[0] = STATUS.NOT_SUPPORTED;
    out[88] = crc(out);
    return out;
  }
  onDisconnect() {
    return () => undefined;
  }
}

// ---- Guarded channel ------------------------------------------------------------------------------------

export interface MouseChannelOptions {
  isDryRun: () => boolean;
  log: (e: Omit<LogEntry, 'id' | 't'>) => void;
  beforeFirstWrite?: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class MouseChannel {
  readonly model: RazerModel;
  private queue: Promise<unknown> = Promise.resolve();
  private wroteOnce = false;

  constructor(
    readonly transport: MouseTransport,
    private opts: MouseChannelOptions,
  ) {
    const m = findRazerModel(transport.productId);
    if (!m) throw new Error(`Unsupported Razer product 0x${transport.productId.toString(16)}`);
    this.model = m;
  }

  /** Send one report and read the reply. Writes are skipped in dry-run mode (returns null). */
  transact(report: Uint8Array): Promise<RazerResponse | null> {
    const run = async () => {
      const v = checkRazerReport(report, this.model);
      const hex = toHexTrimmed(report);
      if (!v.ok) {
        this.opts.log({ dir: 'blocked', hex, label: `mouse: ${v.reason}` });
        throw new MouseBlockedError(v.reason);
      }
      const label = `mouse: ${v.label}`;
      if (v.cls === 'write' && this.opts.isDryRun()) {
        this.opts.log({ dir: 'dry', hex, label });
        return null;
      }
      if (v.cls === 'write' && !this.wroteOnce) {
        await this.opts.beforeFirstWrite?.();
        this.wroteOnce = true;
      }
      this.opts.log({ dir: 'out', hex, label });
      await this.transport.sendFeature(report);
      const wait = this.model.wireless ? 60 : 5;
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(wait);
        const res = parseReport(await this.transport.receiveFeature());
        if (!res) throw new Error('mouse: short reply');
        if (res.status === STATUS.BUSY) continue;
        this.opts.log({ dir: 'in', hex: toHexTrimmed(res.args), label: `${label}: ${STATUS_TEXT[res.status] ?? res.status}` });
        if (res.cls !== report[6] || res.id !== report[7]) throw new Error('mouse: reply does not match request');
        if (res.status !== STATUS.OK) throw new Error(`mouse: ${v.label} → ${STATUS_TEXT[res.status] ?? res.status}`);
        return res;
      }
      throw new Error(`mouse: ${v.label} stayed busy`);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export { buildReport };
