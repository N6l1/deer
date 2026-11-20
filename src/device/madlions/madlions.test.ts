import { describe, expect, it } from 'vitest';
import {
  buildActuationWrites, buildBulkRead, buildLightWrites, buildProtocolQuery, buildRtWrites, buildSetLight, bulkData, decodeLight,
  decodeProtocol, decodeRts, decodeU16s, MAD68_LAYOUT, mmToRaw, report, SUB, TOTAL,
} from './protocol';
import { checkMad, MadChannel, MockMad68 } from './transport';

describe('framing (madlions-control PROTOCOL.md)', () => {
  it('reports are 32 bytes with no report ID', () => {
    expect(buildProtocolQuery().length).toBe(32);
    expect(decodeProtocol(new Uint8Array([1, 0, 9]))).toBe(9);
  });
  it('bulk read: 02 96 SUB 00 00 offHi offLo count', () => {
    expect(Array.from(buildBulkRead(SUB.ACTUATION, 24, 12).subarray(0, 9))).toEqual([2, 0x96, 0x0d, 0, 0, 0, 24, 12, 0]);
  });
  it('actuation write: 11 per packet, flash byte, u16 BE in 0.01 mm, clamped to 0.05–3.40', () => {
    const ps = buildActuationWrites(Array(TOTAL).fill(1.5));
    expect(ps).toHaveLength(7); // 75 / 11
    expect(Array.from(ps[0]!.subarray(0, 13))).toEqual([3, 0x96, 0x0d, 0, 0, 0, 0, 11, 3, 0, 150, 0, 150]);
    expect(Array.from(ps[6]!.subarray(5, 9))).toEqual([0, 66, 9, 3]);
    expect(mmToRaw(0.01)).toBe(5);
    expect(mmToRaw(9)).toBe(340);
  });
  it('rapid trigger write: 4 per packet, [enabled, release u16, press u16]', () => {
    const ps = buildRtWrites(Array.from({ length: TOTAL }, () => ({ enabled: true, release: 0.3, press: 0.15 })), 0);
    expect(ps).toHaveLength(19);
    expect(Array.from(ps[0]!.subarray(0, 14))).toEqual([3, 0x96, 0x0e, 0, 0, 0, 0, 4, 0, 1, 0, 30, 0, 15]);
  });
  it('bulk replies echo offset/count and are validated', () => {
    const r = report(2, 0x96, 0x0d, 0, 0, 0, 12, 2, 0, 150, 0, 40);
    expect(decodeU16s(bulkData(r, 12, 2, 2)!)).toEqual([150, 40]);
    expect(bulkData(r, 0, 2, 2)).toBeNull();
    expect(decodeRts(new Uint8Array([1, 0, 30, 0, 15]))).toEqual([{ enabled: true, release: 0.3, press: 0.15 }]);
  });
  it('lighting: 07 41 effect 00 speed r g b brightness; Off is staged with Solid first; then saved', () => {
    expect(Array.from(buildSetLight({ effect: 6, speed: 128, r: 255, g: 0, b: 0, brightness: 999 }).subarray(0, 10))).toEqual([7, 0x41, 6, 0, 128, 255, 0, 0, 210, 0]);
    const off = buildLightWrites({ effect: 0, speed: 100, r: 1, g: 2, b: 3, brightness: 50 });
    expect(off.map((p) => [p[0], p[2]])).toEqual([[7, 2], [7, 0], [3, 0x12]]);
    expect(decodeLight(new Uint8Array([8, 0x41, 6, 0, 99, 1, 2, 3, 200]))).toEqual({ effect: 6, speed: 99, r: 1, g: 2, b: 3, brightness: 200 });
  });
});

describe('layout', () => {
  it('68 keys on the 5×15 matrix; documented gaps are empty', () => {
    expect(MAD68_LAYOUT.keys).toHaveLength(68);
    const slots = new Set(MAD68_LAYOUT.keys.map((k) => k.slot));
    for (const [r, c] of [[2, 12], [3, 1], [4, 3], [4, 4], [4, 5], [4, 7], [4, 8]]) expect(slots.has(r! * 15 + c!)).toBe(false);
    for (const k of MAD68_LAYOUT.keys) expect(k.x + k.w).toBeLessThanOrEqual(16.001);
    expect(['W', 'A', 'S', 'D'].map((l) => MAD68_LAYOUT.keys.find((k) => k.label === l)?.slot)).toEqual([17, 31, 32, 33]);
  });
});

describe('guard', () => {
  it('allows reads and in-range writes', () => {
    expect(checkMad(buildProtocolQuery())).toMatchObject({ ok: true, cls: 'query' });
    expect(checkMad(buildBulkRead(SUB.TRAVEL, 0, 12))).toMatchObject({ ok: true, cls: 'query' });
    for (const p of [...buildActuationWrites(Array(TOTAL).fill(0.5)), ...buildRtWrites(Array(TOTAL).fill({ enabled: false, release: 0.5, press: 0.5 })), ...buildLightWrites({ effect: 2, speed: 1, r: 0, g: 0, b: 0, brightness: 210 })]) {
      expect(checkMad(p)).toMatchObject({ ok: true, cls: 'write' });
    }
  });
  it('blocks keymap/macro writes, unknown vendor subs, bad ranges and bad flash bytes', () => {
    expect(checkMad(report(0x05, 0, 0, 0, 0, 4)).ok).toBe(false); // set keycode
    expect(checkMad(report(0x0f, 0, 0, 28)).ok).toBe(false); // macro buffer
    expect(checkMad(report(3, 0x96, 0x1f)).ok).toBe(false); // calibration
    expect(checkMad(report(3, 0x96, 0x0d, 0, 0, 0, 0, 1, 3, 0, 2)).ok).toBe(false); // 0.02 mm
    expect(checkMad(report(3, 0x96, 0x0d, 0, 0, 0, 0, 1, 1, 0, 150)).ok).toBe(false); // flash 01
    expect(checkMad(report(3, 0x96, 0x0d, 0, 0, 0, 70, 6, 3, 0, 150, 0, 150, 0, 150, 0, 150, 0, 150, 0, 150)).ok).toBe(false); // past 75
    expect(checkMad(report(7, 0x41, 10, 0, 1)).ok).toBe(false); // unknown effect 10
  });
});

describe('MadChannel with mock', () => {
  const make = (dry: boolean, pid = 0x1058, exp = false) => {
    const mock = new MockMad68(pid);
    let backups = 0;
    const ch = new MadChannel(mock, { isDryRun: () => dry, allowExperimental: () => exp, log: () => undefined, beforeFirstWrite: async () => void backups++ });
    return { mock, ch, backups: () => backups };
  };
  it('reads protocol, actuation and RT', async () => {
    const { ch } = make(true);
    ch.protocol = decodeProtocol((await ch.request(buildProtocolQuery()))!);
    expect(ch.protocol).toBe(9);
    const r = (await ch.request(buildBulkRead(SUB.ACTUATION, 12, 12)))!;
    expect(decodeU16s(bulkData(r, 12, 12, 2)!)).toEqual(Array(12).fill(150));
  });
  it('dry-run logs only; live writes persist and back up once', async () => {
    const dry = make(true);
    dry.ch.protocol = 9;
    for (const p of buildActuationWrites(Array(TOTAL).fill(0.4))) expect(await dry.ch.request(p)).toBeNull();
    expect(dry.mock.act[0]).toBe(150);
    const live = make(false);
    live.ch.protocol = 9;
    for (const p of buildActuationWrites(Array(TOTAL).fill(0.4))) await live.ch.request(p);
    expect(live.mock.act[74]).toBe(40);
    expect(live.mock.persisted).toBe(7);
    expect(live.backups()).toBe(1);
  });
  it('refuses writes on unknown protocol or unverified boards unless experimental is on', async () => {
    const a = make(false);
    await expect(a.ch.request(buildActuationWrites([1])[0]!)).rejects.toThrow(/protocol/);
    const b = make(false, 0x1057);
    b.ch.protocol = 9;
    await expect(b.ch.request(buildActuationWrites([1])[0]!)).rejects.toThrow(/not been verified/);
    const c = make(false, 0x1057, true);
    c.ch.protocol = 9;
    await expect(c.ch.request(buildActuationWrites([1])[0]!)).resolves.toBeTruthy();
  });
});

import {
  buildReadAdvanced, buildReadFeatures, buildWriteAdvanced, buildWriteFeatures, decodeAdvanced, decodeFeatures, emptyAdvanced, freeSlots, socdSlot,
} from './protocol';

describe('Mac / Windows switch (03 96 11)', () => {
  it('reads and writes the five switches, keeping the others', () => {
    expect(Array.from(buildReadFeatures().subarray(0, 4))).toEqual([2, 0x96, 0x11, 0]);
    const f = decodeFeatures(report(2, 0x96, 0x11, 3, 0, 0, 1, 1));
    expect(f).toEqual({ rgbArea: 3, wasdSwap: 0, mac: 0, winLock: 1, nkro: 1 });
    expect(Array.from(buildWriteFeatures({ ...f, mac: 1 }).subarray(0, 9))).toEqual([3, 0x96, 0x11, 3, 0, 1, 1, 1, 0]);
    expect(checkMad(buildWriteFeatures({ ...f, mac: 1 }))).toMatchObject({ ok: true, cls: 'write' });
    expect(checkMad(report(3, 0x96, 0x11, 0, 0, 2, 0, 1)).ok).toBe(false);
  });
});

describe('SOCD (advanced keys, 03 96 20)', () => {
  it('read request and reply layout match madlions-control', () => {
    expect(Array.from(buildReadAdvanced(5).subarray(0, 9))).toEqual([2, 0x96, 0x20, 0, 0, 1, 5, 5, 0]);
    const r = report(2, 0x96, 0x20, 0, 0, 1, 5, 2, 0, 0, 50, 0, 1, 2, 1, 2, 3, 0);
    expect(decodeAdvanced(r)).toEqual({ index: 5, mode: 2, keyId: 0, rsApc: 50, gapc: 0, rt: 1, key1: 31, key2: 33, layer: 0 });
  });
  it('builds an A/D last-input-wins slot exactly like madlions-control', () => {
    const k = socdSlot(emptyAdvanced(15), 31, 33, 2);
    expect(Array.from(buildWriteAdvanced(k).subarray(0, 19))).toEqual([3, 0x96, 0x20, 0, 0, 3, 15, 2, 0, 0, 50, 0, 0, 2, 1, 2, 3, 0, 0]);
    expect(checkMad(buildWriteAdvanced(k))).toMatchObject({ ok: true, cls: 'write' });
    expect(checkMad(buildWriteAdvanced(emptyAdvanced(15)))).toMatchObject({ ok: true, cls: 'write' });
  });
  it('guard: only SOCD modes, physical keys, distinct keys; clears must be all zero', () => {
    expect(checkMad(buildWriteAdvanced({ ...socdSlot(emptyAdvanced(0), 31, 33, 2), mode: 1 })).ok).toBe(false); // RS
    expect(checkMad(buildWriteAdvanced({ ...socdSlot(emptyAdvanced(0), 31, 33, 2), mode: 6 })).ok).toBe(false); // OKS
    expect(checkMad(buildWriteAdvanced(socdSlot(emptyAdvanced(0), 31, 31, 2))).ok).toBe(false);
    expect(checkMad(buildWriteAdvanced(socdSlot(emptyAdvanced(0), 42, 33, 2))).ok).toBe(false); // (2,12) is an empty cell
    expect(checkMad(buildWriteAdvanced({ ...emptyAdvanced(0), layer: 1 })).ok).toBe(false);
    expect(checkMad(buildWriteAdvanced(socdSlot(emptyAdvanced(16), 31, 33, 2))).ok).toBe(false);
  });
  it('new pairs take free slots from 15 down, skipping slots in use', () => {
    const slots = Array.from({ length: 16 }, (_, i) => emptyAdvanced(i));
    slots[15] = socdSlot(slots[15]!, 31, 33, 2);
    slots[14] = { ...slots[14]!, mode: 1 };
    expect(freeSlots(slots).slice(0, 2)).toEqual([13, 12]);
  });
  it('mock round-trip: write a pair, read it back; RS slot is left untouched', async () => {
    const mock = new MockMad68();
    const ch = new MadChannel(mock, { isDryRun: () => false, allowExperimental: () => false, log: () => undefined });
    ch.protocol = 9;
    await ch.request(buildWriteAdvanced(socdSlot(emptyAdvanced(15), 31, 33, 2)));
    expect(decodeAdvanced((await ch.request(buildReadAdvanced(15)))!)).toMatchObject({ mode: 2, key1: 31, key2: 33 });
    expect(decodeAdvanced((await ch.request(buildReadAdvanced(3)))!).mode).toBe(1);
  });
});
