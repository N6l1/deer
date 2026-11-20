import { describe, expect, it } from 'vitest';
import {
  buildGetFeature, buildRequest, decodeBattery, decodeDpi, decodeHitsButton, decodeHitsCaps, decodeOnboardMode, decodeReportRate,
  encodeHitsButton, parseReply,
} from './hidpp';
import { checkHidpp, HidppChannel, HidppError, MockSuperstrike } from './transport';

const caps = decodeHitsCaps(new Uint8Array([0x00, 0x03, 0x28, 0x14, 0x14, 0x01])); // fn0 reply from kazehana99k's capture

describe('HID++ framing', () => {
  it('long request: [dev, feature, fn<<4|swid, params…] padded to 19 bytes', () => {
    const r = buildRequest(0x01, 0x0c, 2, [0x00]);
    expect(r.length).toBe(19);
    expect(Array.from(r.subarray(0, 5))).toEqual([0x01, 0x0c, 0x2a, 0x00, 0x00]);
    expect(Array.from(buildGetFeature(0x01, 0x1b0c).subarray(0, 5))).toEqual([0x01, 0x00, 0x0a, 0x1b, 0x0c]);
  });
  it('parses ok and error replies', () => {
    expect(parseReply(new Uint8Array([1, 0x0c, 0x2a, 0, 0x14]))).toMatchObject({ kind: 'ok', featureIndex: 0x0c, fn: 2, swid: 0x0a });
    expect(parseReply(new Uint8Array([1, 0xff, 0x0c, 0x1a, 0x02]))).toMatchObject({ kind: 'error', featureIndex: 0x0c, fn: 1, code: 2 });
  });
});

describe('SUPERSTRIKE tuning (0x1B0C)', () => {
  it('caps: 2 user buttons, actuation 1-10, rapid trigger 1-5, haptics 0-5', () => {
    expect(caps).toEqual({ buttons: 2, maxActuation: 10, maxRapidTrigger: 5, maxHaptics: 5 });
  });
  it('decodes logical levels (wire = level << 2) and keeps the rapid-trigger flag bit', () => {
    // kazehana99k sample: act 0x0c, rt 0x09, haptics 0x14
    expect(decodeHitsButton(new Uint8Array([0, 0x0c, 0x09, 0x14]))).toEqual({ actuation: 3, rapidTrigger: 2, haptics: 5, rtFlag: 1 });
  });
  it('encodes like Solaar: act<<2, rt<<2 | flag, haptics<<2, clamped to caps', () => {
    expect(encodeHitsButton(0, { actuation: 3, rapidTrigger: 2, haptics: 3, rtFlag: 1 }, caps)).toEqual([0, 0x0c, 0x09, 0x0c]);
    expect(encodeHitsButton(1, { actuation: 99, rapidTrigger: 0, haptics: -1, rtFlag: 0 }, caps)).toEqual([1, 0x28, 0x04, 0x00]);
  });
});

describe('other decoders', () => {
  it('battery, DPI, report rate, onboard mode', () => {
    expect(decodeBattery(new Uint8Array([82, 4, 1]))).toEqual({ percent: 82, charging: true, full: false });
    expect(decodeDpi(new Uint8Array([0, 0x03, 0x20, 0, 0, 0x06, 0x40]))).toEqual({ x: 800, y: 1600 });
    expect(decodeReportRate(new Uint8Array([3]))).toBe(1000);
    expect(decodeReportRate(new Uint8Array([6]))).toBe(8000);
    expect(decodeOnboardMode(new Uint8Array([1]))).toBe('onboard');
  });
});

describe('guard', () => {
  const idx = { ROOT: 0, DEVICE_NAME: 3, SUPERSTRIKE_TUNING: 12, ONBOARD_PROFILES: 14 };
  it('allows feature lookups, reads and in-range tuning writes', () => {
    expect(checkHidpp(buildGetFeature(1, 0x1b0c), 1, idx, caps)).toMatchObject({ ok: true, cls: 'query' });
    expect(checkHidpp(buildRequest(1, 12, 2, [0]), 1, idx, caps)).toMatchObject({ ok: true, cls: 'query' });
    expect(checkHidpp(buildRequest(1, 12, 1, [0, 0x14, 0x0d, 0x0c]), 1, idx, caps)).toMatchObject({ ok: true, cls: 'write' });
  });
  it('blocks unknown features, profile-mode writes, reset and bad tuning bytes', () => {
    expect(checkHidpp(buildGetFeature(1, 0x1802), 1, idx, caps).ok).toBe(false); // DEVICE RESET
    expect(checkHidpp(buildRequest(1, 14, 1, [3]), 1, idx, caps).ok).toBe(false); // unknown onboard mode
    expect(checkHidpp(buildRequest(1, 14, 5, [0]), 1, idx, caps).ok).toBe(false); // profile memory read/write functions
    expect(checkHidpp(buildRequest(1, 18, 0), 1, idx, caps).ok).toBe(false);
    expect(checkHidpp(buildRequest(1, 12, 1, [0, 0x2c, 0x0d, 0x0c]), 1, idx, caps).ok).toBe(false); // actuation 11
    expect(checkHidpp(buildRequest(1, 12, 1, [0, 0x14, 0x00, 0x0c]), 1, idx, caps).ok).toBe(false); // rapid trigger 0
    expect(checkHidpp(buildRequest(1, 12, 1, [0, 0x15, 0x0d, 0x0c]), 1, idx, caps).ok).toBe(false); // not a multiple of 4
    expect(checkHidpp(buildRequest(1, 12, 1, [2, 0x14, 0x0d, 0x0c]), 1, idx, caps).ok).toBe(false); // hidden 3rd button
    expect(checkHidpp(buildRequest(1, 12, 1, [0, 0x14, 0x0d, 0x0c]), 1, idx, null).ok).toBe(false); // caps unknown
  });
});

describe('HidppChannel with mock', () => {
  const make = (dry: boolean) => {
    const mock = new MockSuperstrike();
    let backups = 0;
    const ch = new HidppChannel(mock, { isDryRun: () => dry, log: () => undefined, beforeFirstWrite: async () => void backups++ });
    return { mock, ch, backups: () => backups };
  };
  it('discovers features and reads tuning', async () => {
    const { ch } = make(true);
    await ch.discover();
    expect(ch.features).toMatchObject({ SUPERSTRIKE_TUNING: 12, UNIFIED_BATTERY: 6, ONBOARD_PROFILES: 14 });
    ch.caps = decodeHitsCaps((await ch.request(buildRequest(1, 12, 0)))!);
    expect(decodeHitsButton((await ch.request(buildRequest(1, 12, 2, [0])))!)).toMatchObject({ actuation: 5, rapidTrigger: 3, haptics: 3, rtFlag: 1 });
  });
  it('dry-run skips writes; live write changes the mouse and runs the backup once', async () => {
    const dry = make(true);
    await dry.ch.discover();
    dry.ch.caps = caps;
    expect(await dry.ch.request(buildRequest(1, 12, 1, [0, 0x04, 0x05, 0x00]))).toBeNull();
    expect(dry.mock.hits[0]).toEqual([0x14, 0x0d, 0x0c]);
    const live = make(false);
    await live.ch.discover();
    live.ch.caps = caps;
    await live.ch.request(buildRequest(1, 12, 1, [0, 0x04, 0x05, 0x00]));
    await live.ch.request(buildRequest(1, 12, 1, [1, 0x04, 0x05, 0x00]));
    expect(live.mock.hits[0]).toEqual([0x04, 0x05, 0x00]);
    expect(live.backups()).toBe(1);
  });
  it('turns HID++ errors into readable exceptions', async () => {
    const { ch } = make(false);
    await ch.discover();
    await expect(ch.request(buildRequest(1, 3, 1, [0]))).resolves.toBeTruthy();
    // battery capabilities (fn0) is allowed but the mock answers "invalid function"
    await expect(ch.request(buildRequest(1, 6, 0))).rejects.toThrow(/invalid function/);
    await expect(ch.request(buildRequest(1, 14, 6, [0]))).rejects.toBeInstanceOf(HidppError); // profile memory write: blocked
  });
});


import { decodeActiveProfile, decodeSupportedRates, prettyLogiName, rateToIndex } from './hidpp';

describe('report rate and onboard mode', () => {
  const idx = { ROOT: 0, EXTENDED_REPORT_RATE: 11, ONBOARD_PROFILES: 12 };
  it('decodes the supported-rate flags and maps Hz to the Solaar index', () => {
    expect(decodeSupportedRates(new Uint8Array([0x00, 0x7f]))).toEqual([125, 250, 500, 1000, 2000, 4000, 8000]);
    expect(decodeSupportedRates(new Uint8Array([0x00, 0x1f]))).toEqual([125, 250, 500, 1000, 2000]);
    expect([125, 1000, 8000].map(rateToIndex)).toEqual([0, 3, 6]);
    expect(decodeActiveProfile(new Uint8Array([0, 1]))).toBe(1);
  });
  it('guard: rate write 0..6, onboard mode 1|2, profile 1..5; everything else blocked', () => {
    expect(checkHidpp(buildRequest(1, 11, 3, [6]), 1, idx, null)).toMatchObject({ ok: true, cls: 'write' });
    expect(checkHidpp(buildRequest(1, 11, 3, [7]), 1, idx, null).ok).toBe(false);
    expect(checkHidpp(buildRequest(1, 12, 1, [2]), 1, idx, null)).toMatchObject({ ok: true, cls: 'write' });
    expect(checkHidpp(buildRequest(1, 12, 3, [0, 1]), 1, idx, null)).toMatchObject({ ok: true, cls: 'write' });
    expect(checkHidpp(buildRequest(1, 12, 3, [0, 9]), 1, idx, null).ok).toBe(false);
    expect(checkHidpp(buildRequest(1, 12, 4), 1, idx, null)).toMatchObject({ ok: true, cls: 'query' });
  });
  it('names: "PRO X 2" is the SUPERLIGHT 2', () => {
    expect(prettyLogiName('PRO X 2')).toBe('PRO X SUPERLIGHT 2');
    expect(prettyLogiName('PRO X 2 Superstrike')).toBe('PRO X2 SUPERSTRIKE');
  });
  it('mock SUPERLIGHT 2: rate is ignored in onboard mode and applies in host mode', async () => {
    const mock = new MockSuperstrike(0xc54d, false);
    const ch = new HidppChannel(mock, { isDryRun: () => false, log: () => undefined });
    await ch.discover();
    expect(ch.features.SUPERSTRIKE_TUNING).toBeUndefined();
    const rr = ch.features.EXTENDED_REPORT_RATE!;
    await ch.request(buildRequest(1, rr, 3, [6]));
    expect(decodeReportRate((await ch.request(buildRequest(1, rr, 2)))!)).toBe(1000);
    await ch.request(buildRequest(1, ch.features.ONBOARD_PROFILES!, 1, [2]));
    await ch.request(buildRequest(1, rr, 3, [6]));
    expect(decodeReportRate((await ch.request(buildRequest(1, rr, 2)))!)).toBe(8000);
  });
});
