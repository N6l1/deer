import { describe, expect, it } from 'vitest';
import { checkPacket, type GuardLimits } from './guard';
import { buildCommonSwitch, buildCustomLed, buildIdentityQuery, buildKeymapLayer, buildLedMode, buildTracking, buildTravelPackets, packet } from './packets';
import { BlockedPacketError, Channel, type LogEntry } from './transport';
import { MockKeyboard } from './mock';
import { customLightingMode, findModel } from './models';

const limits: GuardLimits = { apMinByte: 20, apMaxByte: 200, rtMaxByte: 200, ledModes: [0, 1, 2, 3, 4, 5, 6], customLedMode: 19 };
const all = (v: number) => Array<number>(126).fill(v);

describe('allow-list', () => {
  it('blocks the factory reset / clear opcode 0xAA in every form', () => {
    for (const p of [packet(0xaa), packet(0xaa, 0x00, 0x01)]) {
      const r = checkPacket(p, limits);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/factory reset/);
    }
  });
  it('blocks unknown opcodes and wrong sizes', () => {
    expect(checkPacket(packet(0x42), limits).ok).toBe(false);
    expect(checkPacket(new Uint8Array(10), limits).ok).toBe(false);
    expect(checkPacket(packet(0xfd, 0x07, 0x01), limits).ok).toBe(false);
  });
  it('classifies identity as a query and junk after it as invalid', () => {
    expect(checkPacket(buildIdentityQuery(), limits)).toMatchObject({ ok: true, cls: 'query' });
    expect(checkPacket(packet(0xa0, 0x02, 0x00, 0x01), limits).ok).toBe(false);
  });
  it('accepts valid travel packets and rejects out-of-range bytes', () => {
    for (const p of buildTravelPackets('actuation', all(1.0), 'oldHighPrec')) expect(checkPacket(p, limits)).toMatchObject({ ok: true, cls: 'write' });
    const bad = buildTravelPackets('actuation', all(1.0), 'oldHighPrec')[0]!;
    bad[10] = 250;
    expect(checkPacket(bad, limits).ok).toBe(false);
    const tooLow = buildTravelPackets('actuation', all(1.0), 'oldHighPrec')[0]!;
    tooLow[10] = 5;
    expect(checkPacket(tooLow, limits).ok).toBe(false);
  });
  it('rejects LED brightness ≥ 10 and unknown modes', () => {
    const p = buildLedMode({ mode: 2, speed: 5, brightness: 5, colour: 0 });
    expect(checkPacket(p, limits).ok).toBe(true);
    p[6] = 10;
    expect(checkPacket(p, limits).ok).toBe(false);
    expect(checkPacket(buildLedMode({ mode: 30, speed: 1, brightness: 1, colour: 0 }), limits).ok).toBe(false);
  });
  it('accepts the custom LED stream', () => {
    const pro = findModel('A75Pro');
    for (const p of buildCustomLed([0, 2, 3], { 0: '#ffffff' }, 9, customLightingMode(pro))) expect(checkPacket(p, limits).ok).toBe(true);
  });
  it('marks LW/RDT switch states and keymaps as experimental', () => {
    expect(checkPacket(buildCommonSwitch({ turbo: false, rapidTrigger: true, lastWin: false, rdt: false, rtMatch: false }), limits)).toMatchObject({ cls: 'write' });
    expect(checkPacket(buildCommonSwitch({ turbo: false, rapidTrigger: true, lastWin: true, rdt: false, rtMatch: false }), limits)).toMatchObject({ cls: 'experimental' });
    expect(checkPacket(buildKeymapLayer(1, new Map())[0]!, limits)).toMatchObject({ cls: 'experimental' });
  });
  it('rejects a keymap entry placed at the wrong slot', () => {
    const p = buildKeymapLayer(1, new Map([[0, { cmd: 252, code: 4, type: 0 }]]))[0]!;
    p[6] = 7;
    expect(checkPacket(p, limits).ok).toBe(false);
  });
});

describe('Channel', () => {
  const make = (dry: boolean, experimental = false) => {
    const mock = new MockKeyboard();
    const logs: Omit<LogEntry, 'id' | 't'>[] = [];
    let backups = 0;
    const ch = new Channel(mock, {
      limits,
      isDryRun: () => dry,
      allowExperimental: () => experimental,
      log: (e) => logs.push(e),
      beforeFirstWrite: async () => void backups++,
    });
    return { mock, ch, logs, backups: () => backups };
  };

  it('dry-run logs writes without sending, but still lets identity queries through', async () => {
    const { mock, ch, logs } = make(true);
    await ch.send(buildTracking(true));
    expect(mock.sent).toHaveLength(0);
    expect(logs.at(-1)?.dir).toBe('dry');
    const r = await ch.send(buildIdentityQuery(), { expectEcho: true });
    expect(mock.sent).toHaveLength(1);
    expect(r.reply?.[0]).toBe(0xa0);
  });

  it('runs the backup hook exactly once before the first real write', async () => {
    const { ch, backups } = make(false);
    await ch.send(buildIdentityQuery(), { expectEcho: true });
    expect(backups()).toBe(0);
    await ch.send(buildCommonSwitch({ turbo: false, rapidTrigger: true, lastWin: false, rdt: false, rtMatch: false }), { expectEcho: true });
    await ch.send(buildTracking(false));
    expect(backups()).toBe(1);
  });

  it('throws on blocked packets and never sends them', async () => {
    const { mock, ch, logs } = make(false);
    await expect(ch.send(packet(0xaa))).rejects.toBeInstanceOf(BlockedPacketError);
    expect(mock.sent).toHaveLength(0);
    expect(logs.at(-1)?.dir).toBe('blocked');
  });

  it('refuses experimental packets unless enabled', async () => {
    const off = make(false, false);
    await expect(off.ch.send(buildKeymapLayer(1, new Map())[0]!)).rejects.toThrow(/experimental/);
    const on = make(false, true);
    await on.ch.send(buildKeymapLayer(1, new Map())[0]!, { expectEcho: true });
    expect(on.mock.sent).toHaveLength(1);
  });

  it('serialises sends in order', async () => {
    const { mock, ch } = make(false);
    await Promise.all([ch.send(buildTracking(true)), ch.send(buildTracking(false)), ch.send(buildIdentityQuery(), { expectEcho: true })]);
    expect(mock.sent.map((p) => [p[0], p[2]])).toEqual([[0xb6, 1], [0xb6, 0], [0xa0, 0]]);
  });
});
