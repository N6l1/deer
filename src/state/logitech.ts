// Logitech PRO X2 SUPERSTRIKE session: read everything, edit click tuning, preview, write, read back.

import { create } from 'zustand';
import {
  buildRequest, decodeBattery, decodeDpi, decodeHitsButton, decodeHitsCaps, decodeNameChunk, decodeOnboardMode, decodeReportRate,
  encodeHitsButton, type HitsButton, type HitsCaps, type LogiModel,
} from '../device/logitech/hidpp';
import { HidppChannel, MockSuperstrike, WebHidHidppTransport, type HidppTransport } from '../device/logitech/transport';
import { useApp } from './store';
import { downloadJson } from './session';

export interface LogiInfo {
  name?: string;
  battery?: { percent: number | null; charging: boolean; full: boolean };
  dpi?: { x: number; y: number };
  reportRate?: number | null;
  mode?: string;
}

interface LogiState {
  status: 'disconnected' | 'connecting' | 'connected';
  kind?: string;
  model?: LogiModel;
  info: LogiInfo;
  caps: HitsCaps | null;
  device: HitsButton[] | null;
  draft: HitsButton[] | null;
  busy: boolean;
  error?: string;
  setDraft(fn: (d: HitsButton[]) => void): void;
  resetDraft(): void;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const useLogi = create<LogiState>((set, get) => ({
  status: 'disconnected',
  info: {},
  caps: null,
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

let channel: HidppChannel | null = null;
let unsub: (() => void) | null = null;
const app = () => useApp.getState();

export async function attachLogitech(tr: HidppTransport) {
  await disconnectLogitech();
  useLogi.setState({ status: 'connecting', error: undefined });
  try {
    await tr.open();
    channel = new HidppChannel(tr, {
      isDryRun: () => app().settings.dryRun,
      log: (e) => app().addLog(e),
      beforeFirstWrite: async () => {
        const s = useLogi.getState();
        downloadJson(`deertune-logitech-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
          app: 'DeerTune', kind: 'logitech-pre-write-backup', createdAt: new Date().toISOString(), model: s.model, info: s.info, clickTuningOnMouse: s.device,
        });
        app().toast('Mouse click tuning backed up to your downloads before the first write.', 'ok');
      },
    });
    unsub = tr.onDisconnect(() => {
      app().toast('Mouse disconnected', 'warn');
      void disconnectLogitech();
    });
    useLogi.setState({ status: 'connected', kind: tr.kind, model: channel.model });
    await channel.discover();
    await refreshLogitech();
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    useLogi.setState({ status: 'disconnected', error: msg });
    app().toast(msg, 'error');
  }
}

export const connectMockLogitech = async () => {
  await attachLogitech(new MockSuperstrike());
  app().toast('Demo mouse: a simulated PRO X2 SUPERSTRIKE on its LIGHTSPEED receiver.', 'info');
};

export const webHidLogitech = (picked: HIDDevice[]) => WebHidHidppTransport.fromPicked(picked);

export async function disconnectLogitech() {
  unsub?.();
  unsub = null;
  channel?.dispose();
  const tr = channel?.transport;
  channel = null;
  await tr?.close().catch(() => undefined);
  useLogi.setState({ status: 'disconnected', model: undefined, info: {}, caps: null, device: null, draft: null });
}

export async function refreshLogitech() {
  const ch = channel;
  if (!ch) return;
  useLogi.setState({ busy: true });
  const call = async (feat: Parameters<HidppChannel['idx']>[0], fn: number, params: number[] = []) => {
    const i = ch.idx(feat);
    if (i === undefined) return null;
    try {
      return await ch.request(buildRequest(ch.dev, i, fn, params));
    } catch (e) {
      app().addLog({ dir: 'info', hex: '', label: String((e as Error).message) });
      return null;
    }
  };
  const info: LogiInfo = {};
  const len = (await call('DEVICE_NAME', 0))?.[0] ?? 0;
  let name = '';
  for (let off = 0; off < len && off < 64; off += 16) name += decodeNameChunk((await call('DEVICE_NAME', 1, [off]))?.subarray(0, Math.min(16, len - off)) ?? new Uint8Array());
  info.name = name || undefined;
  const bat = await call('UNIFIED_BATTERY', 1);
  if (bat) info.battery = decodeBattery(bat);
  const dpi = await call('EXTENDED_DPI', 5, [0]);
  if (dpi) info.dpi = decodeDpi(dpi);
  const rr = await call('EXTENDED_REPORT_RATE', 2);
  if (rr) info.reportRate = decodeReportRate(rr);
  const mode = await call('ONBOARD_PROFILES', 2);
  if (mode) info.mode = decodeOnboardMode(mode);

  const capsRaw = await call('SUPERSTRIKE_TUNING', 0);
  const caps = capsRaw ? decodeHitsCaps(capsRaw) : null;
  ch.caps = caps;
  let buttons: HitsButton[] | null = null;
  if (caps) {
    buttons = [];
    for (let b = 0; b < caps.buttons; b++) {
      const r = await call('SUPERSTRIKE_TUNING', 2, [b]);
      if (r) buttons.push(decodeHitsButton(r));
    }
    if (buttons.length !== caps.buttons) buttons = null;
  }
  useLogi.setState({
    busy: false,
    info,
    caps,
    device: buttons,
    draft: buttons ? clone(buttons) : null,
    error: !caps ? 'This mouse did not report SUPERSTRIKE click tuning (feature 0x1B0C). If it is wireless, click it to wake it and press Refresh. Also make sure Logitech G HUB is closed.' : undefined,
  });
}

export interface PlannedLogiWrite {
  payload: Uint8Array;
  label: string;
}

export function planLogitech(): PlannedLogiWrite[] {
  const { device, draft, caps } = useLogi.getState();
  if (!channel || !device || !draft || !caps) return [];
  const idx = channel.idx('SUPERSTRIKE_TUNING');
  if (idx === undefined) return [];
  return draft.flatMap((b, i) =>
    JSON.stringify(b) === JSON.stringify(device[i])
      ? []
      : [{ payload: buildRequest(channel!.dev, idx, 1, encodeHitsButton(i, b, caps)), label: `${i === 0 ? 'Left' : 'Right'} button: actuation ${b.actuation}, rapid trigger ${b.rapidTrigger}, haptics ${b.haptics}` }],
  );
}

export async function applyLogitech(plan: PlannedLogiWrite[]) {
  if (!channel) return;
  useLogi.setState({ busy: true });
  try {
    for (const p of plan) await channel.request(p.payload);
    if (app().settings.dryRun) app().toast(`Dry run: ${plan.length} HID++ request(s) shown in the log, nothing sent`, 'info');
    else {
      const wanted = useLogi.getState().draft;
      await refreshLogitech();
      const same = JSON.stringify(wanted) === JSON.stringify(useLogi.getState().device);
      app().toast(same ? `Wrote ${plan.length} request(s) and read them back: click tuning matches.` : 'Wrote to the mouse, but reading back shows different values. Check the HID log.', same ? 'ok' : 'warn');
    }
  } catch (e) {
    app().toast(String((e as Error).message ?? e), 'error');
  } finally {
    useLogi.setState({ busy: false });
  }
}
