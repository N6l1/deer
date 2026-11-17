import { describe, expect, it } from 'vitest';
import {
  buildClearPairs, buildCommonSwitch, buildCustomLed, buildIdentityQuery, buildKeymapLayer, buildKnobBinding,
  buildLastWinPairs, buildLedMode, buildRdtPairs, buildTracking, buildTravelPackets, encodeTravel, hexToRgb,
  parseIdentity, parseTracking, toHex,
} from './packets';
import { customLightingMode, findModel, firmwareLabel, findModelByIdentity, lightingEffects, resolveDialect } from './models';
import { layoutFor, PRESETS } from './layouts';

const head = (p: Uint8Array, n: number) => Array.from(p.subarray(0, n));
const all = (v: number) => Array<number>(126).fill(v);

describe('identity', () => {
  it('query matches cli-drunkdeer BuildIdentity (A0 02) zero-padded to 63 bytes', () => {
    const p = buildIdentityQuery();
    expect(p.length).toBe(63);
    expect(head(p, 3)).toEqual([0xa0, 0x02, 0x00]);
    expect(p.subarray(3).every((b) => b === 0)).toBe(true);
  });

  it('parses an A75 Pro reply (type 0B 04 03, fw 0.023, RT on)', () => {
    const d = new Uint8Array(63);
    d.set([0xa0, 0x02, 0x00, 0x00, 0x0b, 0x04, 0x03, 23, 0]);
    d[16] = 1;
    d[31] = 255;
    const id = parseIdentity(d)!;
    expect(id.typeBytes).toEqual([11, 4, 3]);
    expect(id.firmware).toBe(23);
    expect(id.firmwareLabel).toBe('0.023');
    expect(id.rapidTrigger).toBe(true);
    expect(id.turbo).toBe(false);
    expect(findModelByIdentity(id.typeBytes)?.displayName).toBe('A75 Pro');
  });

  it('rejects non-identity packets', () => {
    expect(parseIdentity(new Uint8Array(63))).toBeNull();
    const d = new Uint8Array(63);
    d.set([0xa0, 0x02, 0x04]);
    expect(parseIdentity(d)).toBeNull();
  });

  it('firmware label follows the official "0.<hi><lo>" format', () => {
    expect(firmwareLabel(9, 0)).toBe('0.09');
    expect(firmwareLabel(23, 0)).toBe('0.023');
  });
});

describe('dialect', () => {
  it('A75 Pro: below fw 17 legacy (mm×10), from 17 old-high-precision (mm×100)', () => {
    expect(resolveDialect(750, 9)).toBe('legacy');
    expect(resolveDialect(750, 17)).toBe('oldHighPrec');
    expect(resolveDialect(750, 23)).toBe('oldHighPrec');
  });
  it('encodes travel per dialect', () => {
    expect(encodeTravel('actuation', 2.0, 'legacy')).toBe(0x14); // CLI DEFAULT_ACTUATION
    expect(encodeTravel('actuation', 2.0, 'oldHighPrec')).toBe(0xc8); // DrunkDeer-Control capture
    expect(encodeTravel('actuation', 0.2, 'oldHighPrec')).toBe(0x14);
    expect(encodeTravel('actuation', 0.05, 'oldHighPrec')).toBe(20); // clamped to 0.2 mm minimum
    expect(encodeTravel('actuation', 3.8, 'oldHighPrec')).toBe(200); // clamped to 2.0 mm
    expect(encodeTravel('downstroke', 0, 'oldHighPrec')).toBe(0);
    expect(encodeTravel('upstroke', 0.15, 'oldHighPrec')).toBe(15);
  });
});

describe('travel packets', () => {
  it('splits 126 slots into 59 + 59 + 8 like cli-drunkdeer BuildModifyRow', () => {
    const ps = buildTravelPackets('actuation', all(2.0), 'legacy');
    expect(ps).toHaveLength(3);
    expect(head(ps[0]!, 4)).toEqual([0xb6, 0x01, 0x00, 0x00]);
    expect(head(ps[1]!, 4)).toEqual([0xb6, 0x01, 0x00, 0x01]);
    expect(head(ps[2]!, 4)).toEqual([0xb6, 0x01, 0x00, 0x02]);
    expect(ps[0]!.subarray(4, 63).every((b) => b === 0x14)).toBe(true);
    expect(ps[2]!.subarray(4, 12).every((b) => b === 0x14)).toBe(true);
    expect(ps[2]!.subarray(12).every((b) => b === 0)).toBe(true);
  });

  it('uses sub-commands 04 / 05 for downstroke / upstroke', () => {
    expect(buildTravelPackets('downstroke', all(0), 'oldHighPrec')[0]![1]).toBe(0x04);
    expect(buildTravelPackets('upstroke', all(0), 'oldHighPrec')[0]![1]).toBe(0x05);
  });

  it('places W (slot 44) at byte 48 of chunk 0 and D (slot 66) at byte 11 of chunk 1', () => {
    const v = all(2.0);
    v[44] = 0.5;
    v[66] = 1.25;
    const ps = buildTravelPackets('actuation', v, 'oldHighPrec');
    expect(ps[0]![4 + 44]).toBe(50);
    expect(ps[1]![4 + 66 - 59]).toBe(125);
  });

  it('rejects wrong lengths', () => {
    expect(() => buildTravelPackets('actuation', [1, 2], 'legacy')).toThrow();
  });
});

describe('common switch', () => {
  it('matches cli-drunkdeer BuildRapidTriggerTurbo(rt=true, turbo=false)', () => {
    const p = buildCommonSwitch({ turbo: false, rapidTrigger: true, lastWin: false, rdt: false, rtMatch: false });
    expect(head(p, 9)).toEqual([0xb5, 0x00, 0x1e, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01]);
    expect(p.subarray(9).every((b) => b === 0)).toBe(true);
  });
  it('matches deerctl set_modes byte layout including the LW/RDT enum', () => {
    const p = buildCommonSwitch({ turbo: true, rapidTrigger: true, lastWin: true, rdt: true, rtMatch: true });
    expect(head(p, 12)).toEqual([181, 0, 30, 1, 0, 0, 1, 1, 1, 0, 3, 1]);
  });
  it('keystroke tracking toggle is B6 03 <0|1>', () => {
    expect(head(buildTracking(true), 3)).toEqual([0xb6, 0x03, 0x01]);
    expect(head(buildTracking(false), 3)).toEqual([0xb6, 0x03, 0x00]);
  });
});

describe('lighting', () => {
  const pro = findModel('A75Pro');
  it('effect codes match the CLI table (Off 0, Always 2, Breath 4, Laser 17, Random Fountain 18)', () => {
    const byName = Object.fromEntries(lightingEffects(pro).map((e) => [e.name, e.code]));
    expect(byName['Off']).toBe(0);
    expect(byName['Rotate Marquee']).toBe(1);
    expect(byName['Always On']).toBe(2);
    expect(byName['Spectrum']).toBe(3);
    expect(byName['Breath']).toBe(4);
    expect(byName['Light by Press']).toBe(5);
    expect(byName['Stars']).toBe(6);
    expect(byName['Laser Key']).toBe(17);
    expect(byName['Random Fountain']).toBe(18);
    expect(customLightingMode(pro)).toEqual({ code: 19, packets: 7 });
  });
  it('mode packet matches deerctl set_effect: AE 01 00 00 mode speed brightness colour', () => {
    expect(head(buildLedMode({ mode: 4, speed: 5, brightness: 9, colour: 1 }), 8)).toEqual([0xae, 1, 0, 0, 4, 5, 9, 1]);
  });
  it('clamps speed and brightness to 0..9 (values ≥ 10 reportedly brick the A75 Pro)', () => {
    const p = buildLedMode({ mode: 2, speed: 50, brightness: 10, colour: 99 });
    expect([p[5], p[6], p[7]]).toEqual([9, 9, 7]);
  });
  it('custom per-key stream: fixed packet count, 0x80+slot entries, FF terminators', () => {
    const slots = layoutFor(pro).keys.map((k) => k.slot).sort((a, b) => a - b);
    const ps = buildCustomLed(slots, { 0: '#ff8000', 44: '#00ff00' }, 7, customLightingMode(pro));
    expect(ps).toHaveLength(7);
    expect(head(ps[0]!, 12)).toEqual([0xae, 1, 0, 0, 19, 6, 7, 0xff, 0x80, 0xff, 0x80, 0x00]);
    // 82 keys = 6 full packets of 13 + 4 entries in the last one
    expect(ps[0]![8 + 13 * 4]).toBe(0xff);
    expect(ps[6]![8 + 4 * 4]).toBe(0xff);
    const wIndex = slots.indexOf(44);
    const pk = ps[Math.floor(wIndex / 13)]!;
    const off = 8 + (wIndex % 13) * 4;
    expect(Array.from(pk.subarray(off, off + 4))).toEqual([0x80 + 44, 0, 255, 0]);
  });
  it('hexToRgb handles short and long forms', () => {
    expect(hexToRgb('#f80')).toEqual([255, 136, 0]);
    expect(hexToRgb('12ab34')).toEqual([0x12, 0xab, 0x34]);
  });
});

describe('experimental packets', () => {
  it('keymap layer matches deerctl write_layer layout', () => {
    const ps = buildKeymapLayer(1, new Map([[0, { cmd: 252, code: 41, type: 0 }], [10, { cmd: 252, code: 1, type: 1 }]]));
    expect(ps).toHaveLength(14);
    expect(head(ps[0]!, 12)).toEqual([160, 2, 4, 1, 14, 1, 0, 252, 0, 41, 0, 0]);
    expect(ps[0]![60]).toBe(165);
    // slot 10 = packet 2, entry 1 → offset 12
    expect(Array.from(ps[1]!.subarray(12, 18))).toEqual([10, 252, 1, 0, 0, 0]);
  });
  it('Last Win pairs: FC 01 00 n [a b 0 0]…', () => {
    expect(head(buildLastWinPairs([[64, 66], [66, 64]]), 12)).toEqual([0xfc, 1, 0, 2, 64, 66, 0, 0, 66, 64, 0, 0]);
    expect(head(buildClearPairs(1), 3)).toEqual([0xfc, 0x0a, 1]);
  });
  it('RDT pairs carry thresholds at mm×200', () => {
    expect(head(buildRdtPairs([[64, 66]], 0.1, 2.0), 11)).toEqual([0xfc, 3, 1, 64, 66, 20, 0, 0x90, 0x01, 0, 0]);
  });
  it('knob binding', () => {
    expect(head(buildKnobBinding(1, { cmd: 144, code: 144, type: 3 }), 8)).toEqual([0xc1, 3, 1, 1, 0, 144, 0, 0]);
    expect(head(buildKnobBinding(2, null), 5)).toEqual([0xc1, 3, 2, 0, 0]);
  });
});

describe('tracking stream', () => {
  it('parses B7 chunks with dialect scale and dead zone', () => {
    const d = new Uint8Array(63);
    d.set([0xb7, 0, 0, 1]);
    d[4 + (66 - 59)] = 150; // D at 1.5 mm (×100)
    d[4] = 10; // below dead zone
    const out = parseTracking(d, 'oldHighPrec')!;
    expect(out).toHaveLength(59);
    expect(out.find((x) => x.slot === 66)?.mm).toBe(1.5);
    expect(out[0]).toEqual({ slot: 59, mm: 0 });
    expect(parseTracking(d, 'legacy')!.find((x) => x.slot === 66)?.mm).toBe(15);
  });
});

describe('layout', () => {
  it('A75 Pro has 82 unique keys that all exist in the default keymap', () => {
    const pro = findModel('A75Pro');
    const keys = layoutFor(pro).keys;
    expect(keys).toHaveLength(82);
    expect(new Set(keys.map((k) => k.slot)).size).toBe(82);
    const defaults = new Set(pro.defaults.map((d) => d.slot));
    keys.forEach((k) => expect(defaults.has(k.slot)).toBe(true));
  });
  it('quick-select presets point at the expected keys', () => {
    const labels = new Map(layoutFor(findModel('A75Pro')).keys.map((k) => [k.slot, k.label]));
    expect(PRESETS.wasd.map((s) => labels.get(s))).toEqual(['W', 'A', 'S', 'D']);
    expect(PRESETS.numerals.map((s) => labels.get(s)).join('')).toBe('1234567890');
    expect(PRESETS.character.map((s) => labels.get(s)).join('')).toBe('QWERTYUIOPASDFGHJKLZXCVBNM');
  });
  it('all rows of the A75 layout fit in 16 units', () => {
    for (const k of layoutFor(findModel('A75Pro')).keys) expect(k.x + k.w).toBeLessThanOrEqual(16.001);
  });
});

describe('toHex', () => {
  it('formats bytes', () => expect(toHex([0, 15, 255])).toBe('00 0f ff'));
});
