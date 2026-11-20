// MAD68 HE session. The keyboard reports every value back, so it is the source of truth:
// read → edit draft → preview → write full tables with the flash-commit byte → read back.

import { create } from 'zustand';
import {
  buildActuationWrites, buildBulkRead, buildLightWrites, buildRtWrites, buildProtocolQuery, buildReadLight, bulkData, decodeLight, decodeProtocol,
  decodeRts, decodeU16s, MAX_ACT_READ, MAX_RT_READ, MAX_TRAVEL_READ, rawToMm, SUB, TOTAL, type Light, type MadBoard, type RapidTrigger,
} from '../device/madlions/protocol';
import { MadChannel, MockMad68, WebHidMadTransport, type MadTransport } from '../device/madlions/transport';
import { useApp, pushDepth } from './store';
import { downloadJson } from './session';

export interface MadSettings {
  act: number[];
  rt: RapidTrigger[];
  light: Light | null;
}

interface MadState {
  status: 'disconnected' | 'connecting' | 'connected';
  kind?: string;
  board?: MadBoard;
  protocol: number | null;
  writeBlock: string | null;
  device: MadSettings | null;
  draft: MadSettings | null;
  selection: number[];
  live: boolean;
  busy: boolean;
  error?: string;
  setDraft(fn: (d: MadSettings) => void): void;
  resetDraft(): void;
  setSelection(s: number[]): void;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const useMad = create<MadState>((set, get) => ({
  status: 'disconnected',
  protocol: null,
  writeBlock: null,
  device: null,
  draft: null,
  selection: [],
  live: false,
  busy: false,
  setDraft: (fn) => {
    const d = get().draft;
    if (!d) return;
    const n = clone(d);
    fn(n);
    set({ draft: n });
  },
  resetDraft: () => set({ draft: get().device ? clone(get().device!) : null }),
  setSelection: (selection) => set({ selection }),
}));

let channel: MadChannel | null = null;
let unsub: (() => void) | null = null;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
const app = () => useApp.getState();

async function attach(tr: MadTransport) {
  await disconnectMad();
  useMad.setState({ status: 'connecting', error: undefined });
  try {
    await tr.open();
    channel = new MadChannel(tr, {
      isDryRun: () => app().settings.dryRun,
      allowExperimental: () => app().settings.allowExperimental,
      log: (e) => app().addLog(e),
      beforeFirstWrite: async () => {
        const s = useMad.getState();
        downloadJson(`deertune-mad68-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
          app: 'DeerTune', kind: 'mad68-pre-write-backup', createdAt: new Date().toISOString(), board: s.board, protocol: s.protocol, settingsOnKeyboard: s.device,
        });
        app().toast('Keyboard settings backed up to your downloads before the first write.', 'ok');
      },
    });
    unsub = tr.onDisconnect(() => {
      app().toast('MAD 68 HE disconnected', 'warn');
      void disconnectMad();
    });
    const r = await channel.request(buildProtocolQuery());
    channel.protocol = r ? decodeProtocol(r) : null;
    useMad.setState({ status: 'connected', kind: tr.kind, board: channel.board, protocol: channel.protocol });
    await refreshMad();
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    useMad.setState({ status: 'disconnected', error: msg });
    app().toast(msg, 'error');
  }
}

export async function connectMad() {
  try {
    const tr = await WebHidMadTransport.request();
    if (tr) await attach(tr);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    useMad.setState({ status: 'disconnected', error: msg });
    app().toast(msg, 'error');
  }
}

export async function connectMockMad() {
  await attach(new MockMad68());
  app().toast('Demo keyboard: a simulated MADLIONS MAD68 HE RGB (protocol 9).', 'info');
}

export async function disconnectMad() {
  setMadLive(false);
  unsub?.();
  unsub = null;
  channel?.dispose();
  const tr = channel?.transport;
  channel = null;
  await tr?.close().catch(() => undefined);
  useMad.setState({ status: 'disconnected', board: undefined, protocol: null, device: null, draft: null, selection: [], live: false });
}

async function readTable<T>(sub: number, per: number, entry: number, decode: (d: Uint8Array) => T[], quiet = false): Promise<T[]> {
  const out: T[] = [];
  while (out.length < TOTAL) {
    const off = out.length;
    const n = Math.min(per, TOTAL - off);
    const r = await channel!.request(buildBulkRead(sub, off, n), { quiet, timeoutMs: quiet ? 600 : 1000 });
    const data = r && bulkData(r, off, n, entry);
    if (!data) throw new Error(`unexpected reply while reading offset ${off}`);
    out.push(...decode(data));
  }
  return out;
}

export async function refreshMad() {
  if (!channel) return;
  useMad.setState({ busy: true });
  try {
    const act = (await readTable(SUB.ACTUATION, MAX_ACT_READ, 2, decodeU16s)).map(rawToMm);
    const rt = await readTable(SUB.RT, MAX_RT_READ, 5, decodeRts);
    let light: Light | null = null;
    try {
      const l = await channel.request(buildReadLight());
      if (l) light = decodeLight(l);
    } catch (e) {
      app().addLog({ dir: 'info', hex: '', label: String((e as Error).message) });
    }
    const device: MadSettings = { act, rt, light };
    useMad.setState({ device, draft: clone(device), writeBlock: channel.writeBlock(), error: undefined });
  } catch (e) {
    useMad.setState({ error: String((e as Error).message ?? e) });
  } finally {
    useMad.setState({ busy: false });
  }
}

/** Live travel: poll the linearised-travel buffer (read-only) and feed the shared depth view. */
export function setMadLive(on: boolean) {
  useMad.setState({ live: on });
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = null;
  if (!on) return pushDepth(Array.from({ length: TOTAL }, (_, slot) => ({ slot, mm: 0 })));
  const tick = async () => {
    if (!channel || !useMad.getState().live) return;
    try {
      const raw = await readTable(SUB.TRAVEL, MAX_TRAVEL_READ, 2, decodeU16s, true);
      pushDepth(raw.map((v, slot) => ({ slot, mm: rawToMm(v) })));
    } catch {
      /* skip a frame */
    }
    liveTimer = setTimeout(() => void tick(), 60);
  };
  void tick();
}

export interface PlannedMadWrite {
  payload: Uint8Array;
  label: string;
}

export function planMad(): PlannedMadWrite[] {
  const { device, draft } = useMad.getState();
  if (!device || !draft) return [];
  const out: PlannedMadWrite[] = [];
  // The full table is always written with the flash-commit byte, like madlions-control's commit():
  // a flash erase must never leave keys you didn't touch with stale values.
  if (JSON.stringify(draft.act) !== JSON.stringify(device.act)) buildActuationWrites(draft.act).forEach((p, i, a) => out.push({ payload: p, label: `Actuation table ${i + 1}/${a.length} (save to flash)` }));
  if (JSON.stringify(draft.rt) !== JSON.stringify(device.rt)) buildRtWrites(draft.rt).forEach((p, i, a) => out.push({ payload: p, label: `Rapid trigger table ${i + 1}/${a.length} (save to flash)` }));
  if (draft.light && JSON.stringify(draft.light) !== JSON.stringify(device.light)) buildLightWrites(draft.light).forEach((p, i, a) => out.push({ payload: p, label: i === a.length - 1 ? 'Save lighting' : 'Lighting effect' }));
  return out;
}


export function pendingMad(): number {
  const { device, draft } = useMad.getState();
  if (!device || !draft) return 0;
  let n = 0;
  for (let i = 0; i < TOTAL; i++) {
    if (Math.abs((draft.act[i] ?? 0) - (device.act[i] ?? 0)) > 1e-6) n++;
    if (JSON.stringify(draft.rt[i]) !== JSON.stringify(device.rt[i])) n++;
  }
  if (JSON.stringify(draft.light) !== JSON.stringify(device.light)) n++;
  return n;
}

export async function applyMad(plan: PlannedMadWrite[]) {
  if (!channel) return;
  const wasLive = useMad.getState().live;
  setMadLive(false);
  useMad.setState({ busy: true });
  try {
    for (const p of plan) await channel.request(p.payload);
    if (app().settings.dryRun) app().toast(`Dry run: ${plan.length} report(s) shown in the log, nothing sent`, 'info');
    else {
      const wanted = useMad.getState().draft;
      await refreshMad();
      const got = useMad.getState().device;
      const same = !!wanted && !!got && JSON.stringify(wanted.act) === JSON.stringify(got.act) && JSON.stringify(wanted.rt) === JSON.stringify(got.rt);
      app().toast(same ? `Wrote and saved ${plan.length} report(s); read-back matches.` : 'Wrote to the keyboard, but read-back differs. Check the HID log.', same ? 'ok' : 'warn');
    }
  } catch (e) {
    app().toast(String((e as Error).message ?? e), 'error');
  } finally {
    useMad.setState({ busy: false });
    if (wasLive) setMadLive(true);
  }
}
