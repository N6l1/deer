import type { ModelInfo } from './models';

/** A physical key cap. x/y/w are in key units (1u = one standard key). */
export interface KeyCap {
  slot: number;
  label: string;
  x: number;
  y: number;
  w: number;
}

export interface Layout {
  keys: KeyCap[];
  knob?: { x: number; y: number };
  width: number;
  height: number;
  /** true when geometry was derived automatically rather than drawn from the real board */
  approximate: boolean;
}

type Row = [slot: number, label: string, w?: number, gapBefore?: number][];

// A75 / A75 Pro, 82 keys + rotary knob. Slot numbers come from the official default keymap
// (deerctl models.json); positions follow the physical 75% layout.
const A75_ROWS: { y: number; keys: Row }[] = [
  {
    y: 0,
    keys: [
      [0, 'Esc'], [2, 'F1', 1, 0.25], [3, 'F2'], [4, 'F3'], [5, 'F4'], [6, 'F5', 1, 0.25], [7, 'F6'], [8, 'F7'], [9, 'F8'],
      [10, 'F9', 1, 0.25], [11, 'F10'], [12, 'F11'], [13, 'F12'], [14, 'Del', 1, 0.25],
    ],
  },
  {
    y: 1.25,
    keys: [
      [21, '`'], [22, '1'], [23, '2'], [24, '3'], [25, '4'], [26, '5'], [27, '6'], [28, '7'], [29, '8'], [30, '9'], [31, '0'],
      [32, '-'], [33, '='], [34, 'Backspace', 2], [36, 'Home'],
    ],
  },
  {
    y: 2.25,
    keys: [
      [42, 'Tab', 1.5], [43, 'Q'], [44, 'W'], [45, 'E'], [46, 'R'], [47, 'T'], [48, 'Y'], [49, 'U'], [50, 'I'], [51, 'O'],
      [52, 'P'], [53, '['], [54, ']'], [55, '\\', 1.5], [57, 'PgUp'],
    ],
  },
  {
    y: 3.25,
    keys: [
      [63, 'Caps', 1.75], [64, 'A'], [65, 'S'], [66, 'D'], [67, 'F'], [68, 'G'], [69, 'H'], [70, 'J'], [71, 'K'], [72, 'L'],
      [73, ';'], [74, "'"], [76, 'Enter', 2.25], [78, 'PgDn'],
    ],
  },
  {
    y: 4.25,
    keys: [
      [84, 'Shift', 2.25], [86, 'Z'], [87, 'X'], [88, 'C'], [89, 'V'], [90, 'B'], [91, 'N'], [92, 'M'], [93, ','], [94, '.'],
      [95, '/'], [97, 'Shift', 1.75], [98, '↑'], [100, 'End'],
    ],
  },
  {
    y: 5.25,
    keys: [
      [105, 'Ctrl', 1.25], [106, 'Win', 1.25], [107, 'Alt', 1.25], [111, 'Space', 6.25], [115, 'Alt'], [116, 'Fn'],
      [117, 'Fn2'], [119, '←'], [120, '↓'], [121, '→'],
    ],
  },
];

function build(rows: { y: number; keys: Row }[]): KeyCap[] {
  const out: KeyCap[] = [];
  for (const row of rows) {
    let x = 0;
    for (const [slot, label, w = 1, gap = 0] of row.keys) {
      x += gap;
      out.push({ slot, label, x, y: row.y, w });
      x += w;
    }
  }
  return out;
}

const A75_LAYOUT: Layout = { keys: build(A75_ROWS), knob: { x: 15.1, y: 0 }, width: 16, height: 6.25, approximate: false };

const PRETTY: Record<string, string> = {
  ESC: 'Esc', ARR_UP: '↑', ARR_DW: '↓', ARR_L: '←', ARR_R: '→', SPACE: 'Space', Back: 'Backspace', TAB: 'Tab', CAPS: 'Caps',
};
const WIDTHS: Record<string, number> = {
  Back: 2, TAB: 1.5, '\\|': 1.5, CAPS: 1.75, Enter: 2.25, SPACE: 6.25, Ctrl: 1.25, Win: 1.25,
};

/** Fallback for models without a hand-drawn layout: one row per 21-slot matrix row, in slot order. */
function approximate(model: ModelInfo): Layout {
  const rows = new Map<number, { slot: number; text: string }[]>();
  for (const d of model.defaults) {
    if (!d.text) continue;
    const r = Math.floor(d.slot / 21);
    rows.set(r, [...(rows.get(r) ?? []), { slot: d.slot, text: d.text }]);
  }
  const keys: KeyCap[] = [];
  let y = 0;
  let width = 0;
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    let x = 0;
    const list = rows.get(r) ?? [];
    list.forEach((k, i) => {
      let w = WIDTHS[k.text] ?? 1;
      if (k.text === 'Shift') w = i === 0 ? 2.25 : 1.75;
      if (k.text === 'Alt' && i < 3) w = 1.25;
      keys.push({ slot: k.slot, label: PRETTY[k.text] ?? k.text.slice(0, 1).toUpperCase() + k.text.slice(1), x, y, w });
      x += w;
    });
    width = Math.max(width, x);
    y += 1;
  }
  return { keys, width, height: y, approximate: true };
}

export function layoutFor(model: ModelInfo): Layout {
  if (model.name === 'A75' || model.name === 'A75Pro') return A75_LAYOUT;
  return approximate(model);
}

// Quick-select presets (slot indexes; from cli-drunkdeer consts.go, valid for the A75 family).
export const PRESETS = {
  wasd: [44, 64, 65, 66],
  numerals: [22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
  character: [43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 64, 65, 66, 67, 68, 69, 70, 71, 72, 86, 87, 88, 89, 90, 91, 92],
};
