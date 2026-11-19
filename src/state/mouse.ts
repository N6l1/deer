// Mouse session: unlike the keyboard, the Viper V4 Pro reports every setting back, so the mouse itself
// is the source of truth. We read, edit a draft, preview, write, then read back to confirm.

import { create } from 'zustand';
import {
  buildSetIdle, buildSetLowBattery, buildSetPollRate, buildSetStages, CMD, decodeBattery, decodeCharging, decodeFirmware,
  decodeIdle, decodeLowBattery, decodePollRate, decodeSerial, decodeStages, type DpiStage, type RazerModel,
} from '../device/razer/protocol';
import { MockRazerMouse, MouseChannel, WebHidMouseTransport, type MouseTransport } from '../device/razer/transport';
import { useApp } from './store';
import { downloadJson } from './session';

export interface MouseSettings {
  pollRate: number | null;
  stages: DpiStage[];
  active: number;
  idle: number;
  lowBattery: number;
}

export interface MouseInfo {
  firmware?: string;
  serial?: string;
  battery?: number;
  charging?: boolean;
}

export interface PlannedMouseWrite {
  report: Uint8Array;
  label: string;
}

interface MouseState {
  status: 'disconnected' | 'connecting' | 'connected';
  kind?: string;
  model?: RazerModel;
  info: MouseInfo;
  device: MouseSettings | null;
  draft: MouseSettings | null;
  busy: boolean;
  error?: string;
  setDraft(fn: (d: MouseSettings) => void): void;
  resetDraft(): void;
}

const clone = (s: MouseSettings): MouseSettings => JSON.parse(JSON.stringify(s)) as MouseSettings;

export const useMouse = create<MouseState>((set, get) => ({
  status: 'disconnected',
  info: {},
  device: null,
  draft: null,
  busy: false,
  setDraft: (fn) => {
    const d = get().draft;
    if (!d) return;
    const n = clone(d);
    fn(n);
    set({ draft: n });
  },
  resetDraft: () => set({ draft: get().device ? clone(get().device!) : null }),
}));

let channel: MouseChannel | null = null;
let unsub: (() => void) | null = null;

const app = () => useApp.getState();

async function attach(tr: MouseTransport) {
  await disconnectMouse();
  useMouse.setState({ status: 'connecting', error: undefined });
  await tr.open();
  channel = new MouseChannel(tr, {
    isDryRun: () => app().settings.dryRun,
    log: (e) => app().addLog(e),
    beforeFirstWrite: async () => {
      const s = useMouse.getState();
      downloadJson(`deertune-mouse-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
        app: 'DeerTune',
        kind: 'mouse-pre-write-backup',
        createdAt: new Date().toISOString(),
        model: s.model,
        info: s.info,
        settingsOnMouse: s.device,
      });
      app().toast('Mouse settings backed up to your downloads before the first write.', 'ok');
    },
  });
  unsub = tr.onDisconnect(() => {
    app().toast('Mouse disconnected', 'warn');
    void disconnectMouse();
  });
  useMouse.setState({ status: 'connected', kind: tr.kind, model: channel.model });
  await refreshMouse();
}

export async function connectMouse() {
  try {
    const tr = await WebHidMouseTransport.request();
    if (!tr) return;
    await attach(tr);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    useMouse.setState({ status: 'disconnected', error: msg });
    app().toast(msg, 'error');
  }
}

export async function connectMockMouse() {
  await attach(new MockRazerMouse());
  app().toast('Demo mouse: a simulated Viper V4 Pro on its HyperSpeed dongle.', 'info');
}

export async function disconnectMouse() {
  unsub?.();
  unsub = null;
  const tr = channel?.transport;
  channel = null;
  await tr?.close().catch(() => undefined);
  useMouse.setState({ status: 'disconnected', model: undefined, info: {}, device: null, draft: null });
}

/** Read everything from the mouse. Each read is independent so one unsupported command doesn't hide the rest. */
export async function refreshMouse() {
  if (!channel) return;
  const ch = channel;
  useMouse.setState({ busy: true });
  const read = async <T,>(r: Uint8Array, decode: (a: Uint8Array) => T): Promise<T | undefined> => {
    try {
      const res = await ch.transact(r);
      return res ? decode(res.args) : undefined;
    } catch (e) {
      app().addLog({ dir: 'info', hex: '', label: String((e as Error).message) });
      return undefined;
    }
  };
  const firmware = await read(CMD.getFirmware(), decodeFirmware);
  const serial = await read(CMD.getSerial(), decodeSerial);
  const battery = await read(CMD.getBattery(), decodeBattery);
  const charging = await read(CMD.getCharging(), decodeCharging);
  const pollRate = (await read(CMD.getPollRate(), decodePollRate)) ?? null;
  const st = await read(CMD.getStages(), decodeStages);
  const idle = (await read(CMD.getIdle(), decodeIdle)) ?? 300;
  const lowBattery = (await read(CMD.getLowBattery(), decodeLowBattery)) ?? 0x26;
  const device: MouseSettings = { pollRate, stages: st?.stages ?? [], active: st?.active ?? 1, idle, lowBattery };
  useMouse.setState({
    busy: false,
    info: { firmware, serial, battery, charging },
    device,
    draft: clone(device),
    error: firmware === undefined && st === undefined ? 'The mouse did not answer. If it is wireless, move it to wake it and press Refresh.' : undefined,
  });
}

export function planMouseWrites(): PlannedMouseWrite[] {
  const { device, draft, model } = useMouse.getState();
  if (!device || !draft || !model) return [];
  const out: PlannedMouseWrite[] = [];
  if (draft.pollRate && draft.pollRate !== device.pollRate) buildSetPollRate(draft.pollRate).forEach((r, i) => out.push({ report: r, label: `Polling rate ${draft.pollRate} Hz (${i + 1}/2)` }));
  if (JSON.stringify(draft.stages) !== JSON.stringify(device.stages) || draft.active !== device.active) {
    out.push({ report: buildSetStages(draft.stages, draft.active, model), label: `DPI stages (${draft.stages.map((s) => s.x).join(' / ')}), active ${draft.active}` });
  }
  if (draft.idle !== device.idle) out.push({ report: buildSetIdle(draft.idle), label: `Sleep after ${Math.round(draft.idle / 60)} min` });
  if (draft.lowBattery !== device.lowBattery) out.push({ report: buildSetLowBattery(draft.lowBattery), label: 'Low-battery warning threshold' });
  return out;
}

export async function applyMouse(plan: PlannedMouseWrite[]) {
  if (!channel) return;
  useMouse.setState({ busy: true });
  try {
    for (const p of plan) await channel.transact(p.report);
    if (app().settings.dryRun) app().toast(`Dry run: ${plan.length} mouse report(s) shown in the log, nothing sent`, 'info');
    else {
      const wanted = useMouse.getState().draft;
      await refreshMouse();
      const got = useMouse.getState().device;
      const same = wanted && got && JSON.stringify({ ...wanted, pollRate: wanted.pollRate ?? got.pollRate }) === JSON.stringify(got);
      if (same) app().toast(`Wrote ${plan.length} report(s) to the mouse and read them back: all settings match.`, 'ok');
      else app().toast('Wrote to the mouse, but reading back shows different values. Check the HID log.', 'warn');
    }
  } catch (e) {
    app().toast(String((e as Error).message ?? e), 'error');
  } finally {
    useMouse.setState({ busy: false });
  }
}
