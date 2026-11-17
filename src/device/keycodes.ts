// Remap targets. A target is what a key sends: (cmd, code, type), encoded into a 5-byte slot.
// Values follow deerctl keys.py (MIT), which mirrors the official driver's remap tables.

export interface KeyTarget {
  cmd: number;
  code: number;
  type: number;
}

export interface TargetDef extends KeyTarget {
  id: string;
  label: string;
  group: TargetGroup;
}

export type TargetGroup = 'letters' | 'numbers' | 'basic' | 'function' | 'navigation' | 'keypad' | 'modifiers' | 'media' | 'mouse' | 'keyboard' | 'disable';

export const KEY = 252; // plain HID key
const T: TargetDef[] = [];
const add = (group: TargetGroup, id: string, cmd: number, code: number, type: number, label = id) =>
  T.push({ group, id, cmd, code, type, label });

'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => add('letters', c, KEY, 4 + i, 0, c.toUpperCase()));
'1234567890'.split('').forEach((c, i) => add('numbers', c, KEY, 30 + i, 0));
(
  [
    ['enter', 40, 'Enter'], ['esc', 41, 'Esc'], ['backspace', 42, 'Bksp'], ['tab', 43, 'Tab'], ['space', 44, 'Space'],
    ['minus', 45, '-'], ['equal', 46, '='], ['lbracket', 47, '['], ['rbracket', 48, ']'], ['backslash', 49, '\\'],
    ['semicolon', 51, ';'], ['quote', 52, "'"], ['grave', 53, '`'], ['comma', 54, ','], ['period', 55, '.'],
    ['slash', 56, '/'], ['capslock', 57, 'Caps'],
  ] as const
).forEach(([id, code, label]) => add('basic', id, KEY, code, 0, label));
for (let i = 0; i < 12; i++) add('function', `f${i + 1}`, KEY, 58 + i, 0, `F${i + 1}`);
for (let i = 0; i < 12; i++) add('function', `f${i + 13}`, KEY, 104 + i, 0, `F${i + 13}`);
(
  [
    ['printscreen', 70, 'PrtSc'], ['scrolllock', 71, 'ScrLk'], ['pause', 72, 'Pause'], ['insert', 73, 'Ins'],
    ['home', 74, 'Home'], ['pageup', 75, 'PgUp'], ['delete', 76, 'Del'], ['end', 77, 'End'], ['pagedown', 78, 'PgDn'],
    ['right', 79, '→'], ['left', 80, '←'], ['down', 81, '↓'], ['up', 82, '↑'], ['menu', 101, 'Menu'],
  ] as const
).forEach(([id, code, label]) => add('navigation', id, KEY, code, 0, label));
add('keypad', 'numlock', KEY, 83, 0, 'NumLk');
(
  [['kp-slash', 84, 'KP /'], ['kp-asterisk', 85, 'KP *'], ['kp-minus', 86, 'KP -'], ['kp-plus', 87, 'KP +'], ['kp-enter', 88, 'KP Ent'], ['kp-period', 99, 'KP .']] as const
).forEach(([id, code, label]) => add('keypad', id, KEY, code, 0, label));
for (let i = 1; i <= 9; i++) add('keypad', `kp${i}`, KEY, 88 + i, 0, `KP ${i}`);
add('keypad', 'kp0', KEY, 98, 0, 'KP 0');
(
  [['lctrl', 1, 'LCtrl'], ['lshift', 2, 'LShift'], ['lalt', 4, 'LAlt'], ['rctrl', 16, 'RCtrl'], ['rshift', 32, 'RShift'], ['ralt', 64, 'RAlt'], ['rwin', 128, 'RWin']] as const
).forEach(([id, code, label]) => add('modifiers', id, KEY, code, 1, label));
add('modifiers', 'lwin', KEY, 227, 0, 'LWin');
(
  [['vol-up', 144, 'Vol +'], ['vol-down', 145, 'Vol −'], ['mute', 146, 'Mute'], ['play-pause', 147, 'Play/Pause'], ['stop', 148, 'Stop'], ['prev-track', 149, 'Prev'], ['next-track', 150, 'Next']] as const
).forEach(([id, code, label]) => add('media', id, code, code, 3, label));
(
  [['mouse-left', 176, 'Left click'], ['mouse-right', 177, 'Right click'], ['mouse-middle', 178, 'Middle click'], ['wheel-up', 181, 'Wheel ↑'], ['wheel-down', 182, 'Wheel ↓'], ['wheel-left', 183, 'Wheel ←'], ['wheel-right', 184, 'Wheel →']] as const
).forEach(([id, code, label]) => add('mouse', id, code, code, 3, label));
(
  [['led-toggle', 14, 'LED on/off'], ['led-mode-cycle', 0, 'LED mode ⟳'], ['led-color-cycle', 9, 'LED colour ⟳'], ['led-pause', 13, 'LED pause'], ['led-prev', 2, 'LED prev'], ['led-next', 1, 'LED next'], ['led-bright-up', 4, 'Brightness +'], ['led-bright-down', 5, 'Brightness −'], ['led-speed-up', 7, 'Speed +'], ['led-speed-down', 8, 'Speed −'], ['win-lock', 16, 'Win lock']] as const
).forEach(([id, code, label]) => add('keyboard', id, 251, code, 2, label));
add('keyboard', 'rt-toggle', 253, 32, 2, 'Rapid Trigger toggle');
add('disable', 'none', KEY, 0, 0, 'Disabled');

export const TARGETS: readonly TargetDef[] = T;
export const TARGET_GROUPS: TargetGroup[] = ['letters', 'numbers', 'basic', 'function', 'navigation', 'keypad', 'modifiers', 'media', 'mouse', 'keyboard', 'disable'];

export function sameTarget(a: KeyTarget, b: KeyTarget): boolean {
  return a.cmd === b.cmd && a.code === b.code && a.type === b.type;
}

export function describeTarget(t: KeyTarget): string {
  const hit = T.find((x) => sameTarget(x, t));
  if (hit) return hit.label;
  if (t.cmd === 255) return 'Fn';
  if (t.cmd === 254) return 'Fn2';
  if (t.cmd === KEY && t.type === 0) return `HID 0x${t.code.toString(16).padStart(2, '0')}`;
  return `cmd ${t.cmd}/${t.code}`;
}

/** 5-byte slot body that follows the slot index in a keymap packet (deerctl `Target.slot`). */
export function encodeTarget(t: KeyTarget): number[] {
  if (t.type === 0) return [t.cmd, 0, t.code, 0, 0];
  if (t.type === 1 || t.type === 2) return [t.cmd, t.code, 0, 0, 0];
  return [t.cmd, 0, 0, 0, 0];
}
