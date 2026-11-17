// Transport abstraction. The UI never touches WebHID directly: it talks to a `Channel`,
// which wraps any `KeyboardTransport` (WebHID today; node-hid under Tauri/Electron later).

import { PAYLOAD_SIZE } from './constants';
import { checkPacket, type GuardLimits, type PacketClass } from './guard';
import { toHexTrimmed } from './packets';

export interface KeyboardTransport {
  readonly kind: 'webhid' | 'mock' | string;
  readonly productName: string;
  readonly productId: number;
  open(): Promise<void>;
  close(): Promise<void>;
  /** Send one 63-byte payload as output report 0x04. */
  send(payload: Uint8Array): Promise<void>;
  /** Subscribe to input reports (report ID 0x04, data without the ID). */
  onInput(listener: (data: Uint8Array) => void): () => void;
  onDisconnect(listener: () => void): () => void;
}

export type LogDir = 'out' | 'in' | 'dry' | 'blocked' | 'info';

export interface LogEntry {
  id: number;
  t: number;
  dir: LogDir;
  hex: string;
  label: string;
}

export interface ChannelOptions {
  limits: GuardLimits;
  isDryRun: () => boolean;
  allowExperimental: () => boolean;
  log: (e: Omit<LogEntry, 'id' | 't'>) => void;
  /** Called once before the first real (non-dry-run) write. Must resolve before anything is sent. */
  beforeFirstWrite?: () => Promise<void>;
}

export interface SendResult {
  sent: boolean;
  dryRun: boolean;
  reply: Uint8Array | null;
  cls: PacketClass;
}

export class BlockedPacketError extends Error {}

/** Guarded, serialised access to a transport: allow-list, dry-run, logging, echo matching. */
export class Channel {
  private queue: Promise<unknown> = Promise.resolve();
  private waiters: { op: number; resolve: (d: Uint8Array) => void }[] = [];
  private wroteOnce = false;
  private unsub: () => void;

  constructor(
    readonly transport: KeyboardTransport,
    private opts: ChannelOptions,
  ) {
    this.unsub = transport.onInput((d) => {
      const i = this.waiters.findIndex((w) => w.op === d[0]);
      if (i >= 0) {
        const [w] = this.waiters.splice(i, 1);
        w?.resolve(d);
      }
    });
  }

  setLimits(l: GuardLimits) {
    this.opts.limits = l;
  }

  dispose() {
    this.unsub();
  }

  /**
   * Validate and send one payload. `expectEcho` waits for an input report whose first byte
   * equals the opcode; `pace` is the minimum delay after fire-and-forget packets.
   */
  send(payload: Uint8Array, o: { expectEcho?: boolean; timeoutMs?: number; paceMs?: number; label?: string } = {}): Promise<SendResult> {
    const run = async (): Promise<SendResult> => {
      if (payload.length !== PAYLOAD_SIZE) throw new BlockedPacketError(`payload must be ${PAYLOAD_SIZE} bytes`);
      const verdict = checkPacket(payload, this.opts.limits);
      const hex = toHexTrimmed(payload);
      if (!verdict.ok) {
        this.opts.log({ dir: 'blocked', hex, label: verdict.reason });
        throw new BlockedPacketError(verdict.reason);
      }
      const label = o.label ?? verdict.label;
      if (verdict.cls === 'experimental' && !this.opts.allowExperimental()) {
        const reason = `${label}: experimental packets are disabled (Settings → Allow experimental writes)`;
        this.opts.log({ dir: 'blocked', hex, label: reason });
        throw new BlockedPacketError(reason);
      }
      if (verdict.cls !== 'query' && this.opts.isDryRun()) {
        this.opts.log({ dir: 'dry', hex, label });
        return { sent: false, dryRun: true, reply: null, cls: verdict.cls };
      }
      if (verdict.cls !== 'query' && !this.wroteOnce) {
        await this.opts.beforeFirstWrite?.();
        this.wroteOnce = true;
      }
      const op = payload[0] ?? 0;
      const wait = o.expectEcho ? this.waitFor(op, o.timeoutMs ?? 600) : null;
      this.opts.log({ dir: 'out', hex, label });
      await this.transport.send(payload);
      const reply = wait ? await wait : null;
      if (o.expectEcho && !reply) this.opts.log({ dir: 'info', hex: '', label: `${label}: no reply within ${o.timeoutMs ?? 600} ms` });
      if (!o.expectEcho) await sleep(o.paceMs ?? 40);
      return { sent: true, dryRun: false, reply, cls: verdict.cls };
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private waitFor(op: number, ms: number): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const w = { op, resolve: (d: Uint8Array) => (clearTimeout(timer), resolve(d)) };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve(null);
      }, ms);
      this.waiters.push(w);
    });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
