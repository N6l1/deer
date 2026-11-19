import { describe, expect, it } from 'vitest';
import {
  buildReport, buildSetIdle, buildSetLowBattery, buildSetPollRate, buildSetStages, CMD, crc, decodeBattery, decodeIdle,
  decodePollRate, decodeStages, findRazerModel, parseReport,
} from './protocol';
import { checkRazerReport } from './guard';
import { MockRazerMouse, MouseBlockedError, MouseChannel } from './transport';

const pro = findRazerModel(0x00e6)!;
const head = (r: Uint8Array, n = 8) => Array.from(r.subarray(0, n));

describe('framing', () => {
  it('builds a 90-byte report with transaction 0x1F and XOR checksum over bytes 2..87', () => {
    const r = CMD.getBattery();
    expect(r.length).toBe(90);
    expect(head(r)).toEqual([0x00, 0x1f, 0, 0, 0, 0x02, 0x07, 0x80]);
    expect(r[88]).toBe(0x02 ^ 0x07 ^ 0x80);
    expect(r[89]).toBe(0);
  });
  it('parses replies with or without a leading report-ID byte', () => {
    const r = buildReport(0x07, 0x80, 0x02, [0, 255]);
    r[0] = 0x02;
    r[88] = crc(r);
    expect(parseReport(r)).toMatchObject({ status: 2, cls: 7, id: 0x80, crcOk: true });
    const withId = new Uint8Array(91);
    withId.set(r, 1);
    expect(parseReport(withId)?.args[1]).toBe(255);
  });
});

describe('commands (OpenRazer / Synapse capture fixtures)', () => {
  it('polling rate: 00 40 size 2, sent with arg 0x00 then 0x01; 8000 Hz = 0x01, 125 Hz = 0x40', () => {
    const [a, b] = buildSetPollRate(8000);
    expect(head(a!, 10)).toEqual([0, 0x1f, 0, 0, 0, 2, 0x00, 0x40, 0x00, 0x01]);
    expect(head(b!, 10)).toEqual([0, 0x1f, 0, 0, 0, 2, 0x00, 0x40, 0x01, 0x01]);
    expect(buildSetPollRate(125)[0]![9]).toBe(0x40);
    expect(() => buildSetPollRate(250)).toThrow();
    expect(decodePollRate(new Uint8Array([0, 0x08]))).toBe(1000);
  });
  it('DPI stages: 04 06 size 0x26, varstore 1, active, count, 7 bytes per stage, big-endian DPI', () => {
    const r = buildSetStages([{ id: 1, x: 800, y: 800 }, { id: 2, x: 1600, y: 1200 }], 2, pro);
    expect(head(r, 8)).toEqual([0, 0x1f, 0, 0, 0, 0x26, 0x04, 0x06]);
    expect(Array.from(r.subarray(8, 25))).toEqual([1, 2, 2, 1, 0x03, 0x20, 0x03, 0x20, 0, 0, 2, 0x06, 0x40, 0x04, 0xb0, 0, 0]);
  });
  it('clamps DPI to 100..50000 and rejects bad stage counts', () => {
    const r = buildSetStages([{ id: 1, x: 99999, y: 10 }], 1, pro);
    expect([(r[12]! << 8) | r[13]!, (r[14]! << 8) | r[15]!]).toEqual([50000, 100]);
    expect(() => buildSetStages([], 1, pro)).toThrow();
    expect(() => buildSetStages([{ id: 1, x: 800, y: 800 }], 2, pro)).toThrow();
  });
  it('decodes the stage response layout documented by OpenRazer', () => {
    const a = new Uint8Array(80);
    a.set([0x01, 0x02, 0x02, 0x01, 0x03, 0x20, 0x03, 0x20, 0, 0, 0x02, 0x07, 0x08, 0x07, 0x08, 0, 0]);
    expect(decodeStages(a)).toEqual({ active: 2, stages: [{ id: 1, x: 800, y: 800 }, { id: 2, x: 1800, y: 1800 }] });
  });
  it('sleep timer and low-battery threshold', () => {
    expect(Array.from(buildSetIdle(300).subarray(5, 10))).toEqual([2, 0x07, 0x03, 0x01, 0x2c]);
    expect(buildSetIdle(5)[9]).toBe(60);
    expect(decodeIdle(new Uint8Array([0x03, 0x84]))).toBe(900);
    expect(buildSetLowBattery(0xff)[8]).toBe(0x3f);
    expect(decodeBattery(new Uint8Array([0, 255]))).toBe(100);
  });
});

describe('guard', () => {
  it('allows the known reads and writes', () => {
    for (const r of Object.values(CMD)) expect(checkRazerReport(r(), pro)).toMatchObject({ ok: true, cls: 'query' });
    for (const r of [...buildSetPollRate(1000), buildSetStages([{ id: 1, x: 800, y: 800 }], 1, pro), buildSetIdle(600), buildSetLowBattery(0x20)]) {
      expect(checkRazerReport(r, pro)).toMatchObject({ ok: true, cls: 'write' });
    }
  });
  it('blocks device mode, unknown commands, bad checksums and out-of-range values', () => {
    expect(checkRazerReport(buildReport(0x00, 0x04, 0x02, [0x03, 0x00]), pro).ok).toBe(false); // device mode
    expect(checkRazerReport(buildReport(0x0f, 0x02, 0x10), pro).ok).toBe(false);
    const bad = CMD.getBattery();
    bad[88] = (bad[88] ?? 0) ^ 1;
    expect(checkRazerReport(bad, pro).ok).toBe(false);
    expect(checkRazerReport(buildReport(0x07, 0x03, 0x02, [0x00, 0x05]), pro).ok).toBe(false); // 5 s sleep
    expect(checkRazerReport(buildReport(0x00, 0x40, 0x02, [0x00, 0x03]), pro).ok).toBe(false); // bad poll code
  });
});

describe('MouseChannel with mock', () => {
  const make = (dry: boolean) => {
    const mock = new MockRazerMouse();
    let backups = 0;
    const ch = new MouseChannel(mock, { isDryRun: () => dry, log: () => undefined, beforeFirstWrite: async () => void backups++ });
    return { mock, ch, backups: () => backups };
  };
  it('reads stages and battery', async () => {
    const { ch } = make(true);
    const s = await ch.transact(CMD.getStages());
    expect(decodeStages(s!.args).stages).toHaveLength(4);
    expect(decodeBattery((await ch.transact(CMD.getBattery()))!.args)).toBe(78);
  });
  it('dry-run skips writes; live writes run the backup hook once', async () => {
    const dry = make(true);
    expect(await dry.ch.transact(buildSetIdle(600))).toBeNull();
    expect(dry.mock.sent).toHaveLength(0);
    const live = make(false);
    await live.ch.transact(buildSetIdle(600));
    await live.ch.transact(buildSetLowBattery(0x20));
    expect(live.mock.state.idle).toBe(600);
    expect(live.backups()).toBe(1);
  });
  it('refuses blocked reports without sending', async () => {
    const { ch, mock } = make(false);
    await expect(ch.transact(buildReport(0x00, 0x04, 0x02, [3, 0]))).rejects.toBeInstanceOf(MouseBlockedError);
    expect(mock.sent).toHaveLength(0);
  });
});
