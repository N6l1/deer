import data from './data/models.json';
import { SLOT_COUNT } from './constants';

export type Dialect = 'legacy' | 'oldHighPrec';

export interface DefaultKey {
  slot: number;
  cmd: number;
  code: number;
  type: number;
  text: string;
}

export interface ModelInfo {
  name: string;
  displayName: string;
  typeCode: number;
  ids: number[][];
  /** 126 firmware slot names ("" = no key) as used in Antler profile JSON `keyname`. */
  slotNames: string[];
  defaults: DefaultKey[];
  lighting: { id: string; preset: boolean; colourful: boolean }[];
  /** Writes are only enabled for models whose wire format has been verified on hardware by someone. */
  writesEnabled: boolean;
}

interface RawModel {
  name: string;
  typeCode: number;
  ids: number[][];
  layout: string[];
  defaults: [number, number, number, number, string][];
  lighting: [string, number, number][];
}

const DISPLAY: Record<string, string> = { A75: 'A75', A75Pro: 'A75 Pro', G65: 'G65', G60: 'G60', G75: 'G75' };
// A75 Pro wire format is hardware-verified by DrunkDeer-Control (fw 0x09 and 0x17). A75 shares the layout and packets.
const WRITABLE = new Set([750, 75]);

export const MODELS: ModelInfo[] = (data.models as RawModel[]).map((m) => ({
  name: m.name,
  displayName: DISPLAY[m.name] ?? m.name,
  typeCode: m.typeCode,
  ids: m.ids,
  slotNames: m.layout,
  defaults: m.defaults.map(([slot, cmd, code, type, text]) => ({ slot, cmd, code, type, text })),
  lighting: m.lighting.map(([id, preset, colourful]) => ({ id, preset: !!preset, colourful: !!colourful })),
  writesEnabled: WRITABLE.has(m.typeCode),
}));

if (MODELS.some((m) => m.slotNames.length !== SLOT_COUNT)) throw new Error('model table: layout must have 126 slots');

export function findModelByIdentity(t: [number, number, number]): ModelInfo | undefined {
  return MODELS.find((m) => m.ids.some((id) => id[0] === t[0] && id[1] === t[1] && id[2] === t[2]));
}

export function findModel(name: string): ModelInfo {
  const m = MODELS.find((x) => x.name === name);
  if (!m) throw new Error(`unknown model ${name}`);
  return m;
}

/**
 * Firmware number at which each model switched from 0.1 mm to 0.01 mm actuation bytes.
 * Source: deerctl `_HP_FROM` (decimal of the "<hi><lo>" firmware string), matching
 * DrunkDeer-Control's A75 Pro cutoff of 0x11 = 17.
 */
const HIGH_PREC_FROM: Record<number, number> = { 75: 35, 750: 17, 751: 25, 752: 25, 65: 19, 60: 21, 754: 13, 755: 6 };

export function resolveDialect(typeCode: number, firmware: number): Dialect {
  const from = HIGH_PREC_FROM[typeCode];
  return from !== undefined && firmware >= from ? 'oldHighPrec' : 'legacy';
}

export interface TravelRange {
  /** bytes per mm on the wire */
  scale: number;
  apMin: number;
  apMax: number;
  rtMin: number;
  rtMax: number;
  step: number;
  defaultAp: number;
}

/** Slider limits per dialect, from the official driver's clamps (deerctl + DrunkDeer-Control agree). */
export function travelRange(dialect: Dialect): TravelRange {
  return dialect === 'oldHighPrec'
    ? { scale: 100, apMin: 0.2, apMax: 2.0, rtMin: 0, rtMax: 2.0, step: 0.01, defaultAp: 2.0 }
    : { scale: 10, apMin: 0.2, apMax: 3.3, rtMin: 0, rtMax: 3.1, step: 0.1, defaultAp: 2.0 };
}

/** Firmware number as the official driver computes it: decimal of the string "<hi><lo>". */
export function firmwareNumber(lo: number, hi: number): number {
  return Number(`${hi}${lo}`);
}

export function firmwareLabel(lo: number, hi: number): string {
  return `0.${hi}${lo}`;
}

// ---- Lighting -------------------------------------------------------------------

export interface LightingEffect {
  id: string;
  name: string;
  code: number;
  /** effect accepts a preset colour index (byte 7) */
  preset: boolean;
  /** effect supports the rainbow/colourful option */
  colourful: boolean;
}

const EFFECT_NAMES: Record<string, string> = {
  color1: 'Off', color2: 'Rotate Marquee', color3: 'Wave Spectrum', color4: 'Surf Right', color5: 'Breath',
  color6: 'Center Surf', color7: 'Spectrum', color8: 'Ripple', color9: 'Always On', color10: 'Light by Press',
  color11: 'Serpentine', color12: 'Fountain', color13: 'Laser Key', color14: 'Glowing Fish', color15: 'Surf Cross',
  color16: 'Heart', color17: 'Traffic', color18: 'Snake', color19: 'Raindrops', color20: 'Turbo', color21: 'Custom',
  color22: 'Stars', color23: 'Surf Down', color24: 'Surf Repeat', color25: 'Random Fountain', color26: 'Dance of Demons',
};

/**
 * Mode byte = index in the model's lighting table minus 2 (the table starts with Off, Turbo, Custom).
 * Matches the CLI constants (Always=2, Breath=4, ... Custom=19) and deerctl's `effects()`.
 * "Custom" (per-key) is handled separately; "Turbo" is internal to the firmware.
 */
export function lightingEffects(model: ModelInfo): LightingEffect[] {
  return model.lighting
    .map((e, pos) => ({ id: e.id, name: EFFECT_NAMES[e.id] ?? e.id, code: Math.max(0, pos - 2), preset: e.preset, colourful: e.colourful }))
    .filter((e) => e.id !== 'color20' && e.id !== 'color21');
}

export function customLightingMode(model: ModelInfo): { code: number; packets: number } {
  return { code: model.lighting.length - 2, packets: model.name.startsWith('G6') ? 6 : 7 };
}

/** Preset colour index for byte 7 of the LED packet: 0 = rainbow/default, 1..7. */
export const PRESET_COLOURS = [
  { index: 0, name: 'Rainbow', hex: '' },
  { index: 1, name: 'Red', hex: '#ff0000' },
  { index: 2, name: 'Green', hex: '#00ff00' },
  { index: 3, name: 'Blue', hex: '#0000ff' },
  { index: 4, name: 'Yellow', hex: '#ffff00' },
  { index: 5, name: 'Purple', hex: '#ff00ff' },
  { index: 6, name: 'Cyan', hex: '#00ffff' },
  { index: 7, name: 'White', hex: '#ffffff' },
];
