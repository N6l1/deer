// Device session: connects a transport, reads identity, and runs saves through the guarded Channel.

import { findModelByIdentity, lightingEffects, customLightingMode, resolveDialect, travelRange, type Dialect, type ModelInfo } from '../device/models';
import { buildIdentityQuery, buildTracking, parseIdentity, parseTracking, toHex } from '../device/packets';
import { Channel, type KeyboardTransport } from '../device/transport';
import { MockKeyboard } from '../device/mock';
import { WebHidTransport } from '../device/webhid';
import type { GuardLimits } from '../device/guard';
import { cloneProfile, defaultProfile, diffProfiles, EXPERIMENTAL, planSync, type Feature, type PlannedPacket } from '../device/profile';
import { pushDepth, useApp } from './store';
import { translate } from '../i18n';

let channel: Channel | null = null;
let cleanups: (() => void)[] = [];
export let mock: MockKeyboard | null = null;

const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(useApp.getState().settings.lang, k, v);

export function limitsFor(model: ModelInfo, dialect: Dialect): GuardLimits {
  const r = travelRange(dialect);
  return {
    apMinByte: Math.round(r.apMin * r.scale),
    apMaxByte: Math.round(r.apMax * r.scale),
    rtMaxByte: Math.round(r.rtMax * r.scale),
    ledModes: lightingEffects(model).map((e) => e.code),
    customLedMode: customLightingMode(model).code,
  };
}

export async function connectWebHid() {
  const s = useApp.getState();
  try {
    s.setConnection({ status: 'connecting', error: undefined });
    const tr = await WebHidTransport.request();
    if (!tr) return s.setConnection(null);
    await attach(tr);
  } catch (e) {
    s.setConnection({ status: 'disconnected', error: String((e as Error).message ?? e) });
    s.toast(String((e as Error).message ?? e), 'error');
  }
}

export async function reconnectKnown() {
  try {
    const [first] = await WebHidTransport.known();
    if (first) await attach(first);
  } catch {
    /* no previously-authorised device */
  }
}

export async function connectMock() {
  const m = new MockKeyboard();
  await attach(m);
  mock = m;
  useApp.getState().toast(t('demoNote'), 'info');
}

async function attach(tr: KeyboardTransport) {
  const s = useApp.getState();
  await disconnect(false);
  mock = tr instanceof MockKeyboard ? tr : null;
  s.setConnection({ status: 'connecting', kind: tr.kind, productName: tr.productName });
  await tr.open();
  const proModel = findModelByIdentity([11, 4, 3])!;
  channel = new Channel(tr, {
    limits: limitsFor(proModel, 'oldHighPrec'),
    isDryRun: () => useApp.getState().settings.dryRun,
    allowExperimental: () => useApp.getState().settings.allowExperimental,
    log: (e) => useApp.getState().addLog(e),
    beforeFirstWrite: backupBeforeFirstWrite,
  });
  let dialect: Dialect = 'oldHighPrec';
  cleanups.push(
    tr.onInput((d) => {
      const depth = parseTracking(d, dialect);
      if (depth) return pushDepth(depth);
      useApp.getState().addLog({ dir: 'in', hex: toHex(d), label: `in 0x${(d[0] ?? 0).toString(16)}` });
    }),
    tr.onDisconnect(() => {
      useApp.getState().toast(t('disconnected'), 'warn');
      void disconnect(false);
    }),
    () => channel?.dispose(),
  );

  const r = await channel.send(buildIdentityQuery(), { expectEcho: true, timeoutMs: 1500 });
  const identity = r.reply ? parseIdentity(r.reply) : null;
  if (!identity) {
    s.setConnection({ status: 'connected', error: 'No identity reply from keyboard' });
    s.toast('Keyboard did not answer the identity query', 'error');
    return;
  }
  const model = findModelByIdentity(identity.typeBytes);
  dialect = model ? resolveDialect(model.typeCode, identity.firmware) : 'legacy';
  if (model) channel.setLimits(limitsFor(model, dialect));
  s.setConnection({ status: 'connected', identity, model, dialect, error: model ? undefined : t('unknownModel', { bytes: identity.typeBytes.join(' ') }) });

  // make sure the active profile matches the connected model
  if (model && useApp.getState().active().model !== model.name) {
    const existing = useApp.getState().profiles.find((p) => p.model === model.name);
    if (existing) useApp.setState({ activeId: existing.id });
    else useApp.getState().addProfile(defaultProfile(model.name, `${model.displayName} default`, dialect));
  }
  // The firmware cannot report per-key values, so the first time we see a profile we take it as the
  // baseline: Save stays disabled until you change something. Switching profiles later forces a full write.
  const act = useApp.getState().active();
  if (!(act.id in useApp.getState().synced)) useApp.getState().markSynced(act.id, act);
}

export async function disconnect(clear = true) {
  cleanups.forEach((f) => f());
  cleanups = [];
  const tr = channel?.transport;
  channel = null;
  mock = null;
  await tr?.close().catch(() => undefined);
  if (clear !== false) useApp.getState().setConnection(null);
  else useApp.getState().setConnection({ status: 'disconnected', identity: undefined, model: undefined });
}

// ---- saving ------------------------------------------------------------------------------------

export function pendingChanges() {
  const s = useApp.getState();
  const p = s.active();
  const base = p.id in s.synced ? (s.synced[p.id] ?? null) : null;
  return diffProfiles(p, base);
}

/** Packets a save would send right now, with experimental features removed unless allowed. */
export function currentPlan(): { plan: PlannedPacket[]; skipped: Feature[] } {
  const s = useApp.getState();
  const { model, dialect, identity } = s.connection;
  if (!model || !dialect) return { plan: [], skipped: [] };
  const changes = pendingChanges();
  const features = new Set(changes.features);
  const skipped: Feature[] = [];
  const profile = cloneProfile(s.active());
  if (!s.settings.allowExperimental) {
    for (const f of EXPERIMENTAL) if (features.delete(f)) skipped.push(f);
    profile.lastWin.enabled = false;
    profile.rdt.enabled = false;
  }
  return { plan: planSync(profile, dialect, features, identity?.rtMatch ?? false), skipped };
}

export async function runPlan(plan: PlannedPacket[]) {
  const s = useApp.getState();
  if (!channel) throw new Error('not connected');
  s.setSaving(true);
  let sent = 0;
  try {
    for (const step of plan) {
      const r = await channel.send(step.payload, { expectEcho: step.expectEcho, label: step.label });
      if (r.sent) sent++;
    }
    if (s.settings.dryRun) s.toast(t('dryRunDone', { n: plan.length }), 'info');
    else {
      s.markSynced(s.active().id, s.active());
      s.toast(t('savedOk', { n: sent }), 'ok');
    }
  } catch (e) {
    s.toast(String((e as Error).message ?? e), 'error');
  } finally {
    s.setSaving(false);
  }
}

export async function setTracking(on: boolean) {
  if (!channel) return;
  // The demo keyboard is a simulation, so let it stream even in dry-run mode.
  if (mock && useApp.getState().settings.dryRun) await mock.send(buildTracking(on));
  try {
    await channel.send(buildTracking(on), { label: `Keystroke tracking ${on ? 'on' : 'off'}` });
  } catch (e) {
    useApp.getState().toast(String((e as Error).message ?? e), 'error');
  }
}

export const isConnected = () => channel !== null;

// ---- backup ------------------------------------------------------------------------------------

async function backupBeforeFirstWrite() {
  const s = useApp.getState();
  const c = s.connection;
  const p = s.active();
  const doc = {
    app: 'DeerTune',
    kind: 'pre-write-backup',
    createdAt: new Date().toISOString(),
    note:
      'The A75-family firmware cannot report per-key actuation, so this backup holds everything the keyboard does report (identity, mode flags) plus what DeerTune last wrote and the profile about to be written.',
    device: { kind: c.kind, productName: c.productName, model: c.model?.displayName, dialect: c.dialect, firmware: c.identity?.firmwareLabel },
    identity: c.identity,
    lastWrittenByDeerTune: s.synced[p.id] ?? null,
    profileAboutToWrite: p,
    allProfiles: s.profiles,
  };
  downloadJson(`deertune-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, doc);
  s.toast(t('backupDone'), 'ok');
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
