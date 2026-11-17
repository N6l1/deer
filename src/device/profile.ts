// Host-side profile model and the sync planner that turns profile changes into packets.
// Pure functions only, so all of it is unit-testable.

import { SLOT_COUNT } from './constants';
import { sameTarget, type KeyTarget } from './keycodes';
import { layoutFor } from './layouts';
import { customLightingMode, findModel, travelRange, type Dialect, type ModelInfo } from './models';
import {
  buildClearPairs, buildCommonSwitch, buildCustomLed, buildKeymapLayer, buildKnobBinding, buildLastWinPairs,
  buildLedMode, buildRdtPairs, buildTravelPackets, LAYERS, type LayerName, type Packet,
} from './packets';

export interface Profile {
  id: string;
  name: string;
  model: string;
  ap: number[];
  ds: number[];
  us: number[];
  rapidTrigger: boolean;
  turbo: boolean;
  keystrokeTracking: boolean;
  lastWin: { enabled: boolean; pairs: [number, number][] };
  rdt: { enabled: boolean; pairs: [number, number][]; activeMm: number; resetMm: number };
  led: { mode: number; speed: number; brightness: number; colour: number; custom: boolean };
  customColours: Record<number, string>;
  remap: Record<LayerName, Record<number, KeyTarget>>;
  knob: Record<number, KeyTarget | null>;
  updatedAt: number;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function defaultProfile(modelName: string, name = 'Default', dialect: Dialect = 'oldHighPrec'): Profile {
  const r = travelRange(dialect);
  return {
    id: uid(),
    name,
    model: modelName,
    ap: Array(SLOT_COUNT).fill(r.defaultAp),
    ds: Array(SLOT_COUNT).fill(0),
    us: Array(SLOT_COUNT).fill(0),
    rapidTrigger: false,
    turbo: false,
    keystrokeTracking: false,
    lastWin: { enabled: false, pairs: [[64, 66], [44, 65]] },
    rdt: { enabled: false, pairs: [], activeMm: 0.1, resetMm: 2.0 },
    led: { mode: 2, speed: 5, brightness: 5, colour: 0, custom: false },
    customColours: {},
    remap: { base: {}, fn1: {}, fn2: {} },
    knob: {},
    updatedAt: Date.now(),
  };
}

export const cloneProfile = (p: Profile): Profile => JSON.parse(JSON.stringify(p)) as Profile;

// ---- Change counting ------------------------------------------------------------------------

export type Feature = 'actuation' | 'rapidTrigger' | 'turbo' | 'lastWin' | 'rdt' | 'lighting' | 'remap' | 'knob';

export interface ChangeSet {
  count: number;
  features: Set<Feature>;
  changedSlots: Set<number>;
}

const near = (a = 0, b = 0) => Math.abs(a - b) < 1e-6;
const json = (v: unknown) => JSON.stringify(v);

export function diffProfiles(next: Profile, base: Profile | null): ChangeSet {
  const features = new Set<Feature>();
  const changedSlots = new Set<number>();
  let count = 0;
  if (!base) {
    const all: Feature[] = ['actuation', 'rapidTrigger', 'turbo', 'lighting', 'lastWin', 'rdt', 'remap', 'knob'];
    return { count: all.length, features: new Set(all), changedSlots };
  }
  for (let i = 0; i < SLOT_COUNT; i++) {
    const dAp = !near(next.ap[i], base.ap[i]);
    const dRt = !near(next.ds[i], base.ds[i]) || !near(next.us[i], base.us[i]);
    if (dAp || dRt) changedSlots.add(i);
    if (dAp) (count++, features.add('actuation'));
    if (dRt) (count++, features.add('rapidTrigger'));
  }
  if (next.rapidTrigger !== base.rapidTrigger) (count++, features.add('rapidTrigger'));
  if (next.turbo !== base.turbo) (count++, features.add('turbo'));
  if (json(next.lastWin) !== json(base.lastWin)) (count++, features.add('lastWin'));
  if (json(next.rdt) !== json(base.rdt)) (count++, features.add('rdt'));
  if (json(next.led) !== json(base.led)) (count++, features.add('lighting'));
  if (next.led.custom && json(next.customColours) !== json(base.customColours)) (count++, features.add('lighting'));
  for (const layer of Object.keys(LAYERS) as LayerName[]) {
    const a = next.remap[layer];
    const b = base.remap[layer];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[+k];
      const y = b[+k];
      if (!x || !y || !sameTarget(x, y)) (count++, features.add('remap'));
    }
  }
  if (json(next.knob) !== json(base.knob)) (count++, features.add('knob'));
  return { count, features, changedSlots };
}

// ---- Sync planning ---------------------------------------------------------------------------

export interface PlannedPacket {
  payload: Packet;
  feature: Feature;
  expectEcho: boolean;
  label: string;
}

/** Features whose wire format is not settled across sources; gated behind "Allow experimental writes". */
export const EXPERIMENTAL: ReadonlySet<Feature> = new Set(['lastWin', 'rdt', 'remap', 'knob']);

/** Both directions of every undirected Last Win pair. */
export const directedPairs = (pairs: [number, number][]) => pairs.flatMap(([a, b]) => [[a, b], [b, a]] as [number, number][]);

export function baseLayerTargets(model: ModelInfo, overrides: Record<number, KeyTarget>): Map<number, KeyTarget> {
  const m = new Map<number, KeyTarget>();
  for (const d of model.defaults) m.set(d.slot, { cmd: d.cmd, code: d.code, type: d.type });
  for (const [k, t] of Object.entries(overrides)) m.set(+k, t);
  return m;
}

export function planSync(p: Profile, dialect: Dialect, features: Set<Feature>, rtMatch = false): PlannedPacket[] {
  const model = findModel(p.model);
  const out: PlannedPacket[] = [];
  const push = (payload: Packet, feature: Feature, label: string, expectEcho = true) => out.push({ payload, feature, label, expectEcho });

  // Last Win: clear → pairs → common switch (order used by the official driver)
  if (features.has('lastWin') && p.lastWin.enabled) {
    const mode = (p.lastWin.enabled ? 1 : 0) | (p.rdt.enabled ? 2 : 0);
    push(buildClearPairs(mode), 'lastWin', 'Last Win: clear pair table', false);
    push(buildLastWinPairs(directedPairs(p.lastWin.pairs)), 'lastWin', 'Last Win: pairs', false);
  }
  if (features.has('rdt') && p.rdt.enabled) push(buildRdtPairs(p.rdt.pairs, p.rdt.activeMm, p.rdt.resetMm), 'rdt', 'Dual-Trigger: pairs', false);

  if (['rapidTrigger', 'turbo', 'lastWin', 'rdt'].some((f) => features.has(f as Feature))) {
    const feature: Feature = features.has('lastWin') ? 'lastWin' : features.has('rdt') ? 'rdt' : features.has('turbo') ? 'turbo' : 'rapidTrigger';
    push(
      buildCommonSwitch({ turbo: p.turbo, rapidTrigger: p.rapidTrigger, lastWin: p.lastWin.enabled, rdt: p.rdt.enabled, rtMatch }),
      feature,
      'Mode switches (RT / Turbo / LW / RDT)',
    );
  }
  if (features.has('actuation')) buildTravelPackets('actuation', p.ap, dialect).forEach((x, i) => push(x, 'actuation', `Actuation ${i + 1}/3`));
  if (features.has('rapidTrigger')) {
    buildTravelPackets('downstroke', p.ds, dialect).forEach((x, i) => push(x, 'rapidTrigger', `RT downstroke ${i + 1}/3`));
    buildTravelPackets('upstroke', p.us, dialect).forEach((x, i) => push(x, 'rapidTrigger', `RT upstroke ${i + 1}/3`));
  }
  if (features.has('lighting')) {
    if (p.led.custom) {
      const slots = layoutFor(model).keys.map((k) => k.slot).sort((a, b) => a - b);
      buildCustomLed(slots, p.customColours, p.led.brightness, customLightingMode(model)).forEach((x, i, a) =>
        push(x, 'lighting', `Per-key colours ${i + 1}/${a.length}`, false),
      );
    } else push(buildLedMode(p.led), 'lighting', 'Lighting effect', false);
  }
  if (features.has('remap')) {
    for (const layer of Object.keys(LAYERS) as LayerName[]) {
      const targets = layer === 'base' ? baseLayerTargets(model, p.remap.base) : new Map(Object.entries(p.remap[layer]).map(([k, v]) => [+k, v]));
      buildKeymapLayer(LAYERS[layer], targets).forEach((x, i) => push(x, 'remap', `Keymap ${layer} ${i + 1}/14`));
    }
  }
  if (features.has('knob')) {
    for (let ev = 1; ev <= 6; ev++) if (ev in p.knob) push(buildKnobBinding(ev, p.knob[ev] ?? null), 'knob', `Knob event ${ev}`, false);
  }
  return out;
}

// ---- Import / export ----------------------------------------------------------------------------

export interface ProfileFile {
  app: 'DeerTune';
  version: 1;
  profiles: Profile[];
}

export const exportProfiles = (profiles: Profile[]): ProfileFile => ({ app: 'DeerTune', version: 1, profiles });

/** Accepts a DeerTune export, a single DeerTune profile, or an official Antler profile export. */
export function importProfiles(raw: unknown, fallbackModel: string): Profile[] {
  const obj = raw as Record<string, unknown>;
  if (obj && obj.app === 'DeerTune' && Array.isArray(obj.profiles)) return (obj.profiles as Profile[]).map((p) => ({ ...defaultProfile(p.model), ...p, id: uid() }));
  if (obj && Array.isArray(obj.ap) && typeof obj.model === 'string') return [{ ...defaultProfile(obj.model), ...(obj as unknown as Profile), id: uid() }];
  if (obj && Array.isArray(obj.keys_array)) return [fromAntler(obj, fallbackModel)];
  throw new Error('Unrecognised profile file');
}

function fromAntler(obj: Record<string, unknown>, fallbackModel: string): Profile {
  const storage = String(obj.storagename ?? '');
  const model = storage.includes('A75Pro') ? 'A75Pro' : fallbackModel;
  const m = findModel(model);
  const p = defaultProfile(model, String(obj.showname ?? 'Imported'));
  for (const k of obj.keys_array as { keyname: string; action_point: number; downstroke: number; upstroke: number }[]) {
    const slot = m.slotNames.indexOf(k.keyname);
    if (slot < 0) continue;
    p.ap[slot] = Number(k.action_point) || p.ap[slot]!;
    p.ds[slot] = Number(k.downstroke) || 0;
    p.us[slot] = Number(k.upstroke) || 0;
  }
  return p;
}
