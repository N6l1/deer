import { describe, expect, it } from 'vitest';
import { cloneProfile, defaultProfile, diffProfiles, directedPairs, importProfiles, planSync, exportProfiles } from './profile';

describe('diff', () => {
  it('counts per-key and global changes', () => {
    const a = defaultProfile('A75Pro');
    const b = cloneProfile(a);
    expect(diffProfiles(b, a).count).toBe(0);
    b.ap[44] = 0.5;
    b.ap[64] = 0.5;
    b.rapidTrigger = true;
    const d = diffProfiles(b, a);
    expect(d.count).toBe(3);
    expect([...d.features].sort()).toEqual(['actuation', 'rapidTrigger']);
    expect([...d.changedSlots].sort()).toEqual([44, 64]);
  });
  it('treats an unsynced profile as fully changed', () => {
    expect(diffProfiles(defaultProfile('A75Pro'), null).features.has('actuation')).toBe(true);
  });
});

describe('planSync', () => {
  it('actuation-only change sends exactly the 3 actuation packets', () => {
    const p = defaultProfile('A75Pro');
    const plan = planSync(p, 'oldHighPrec', new Set(['actuation']));
    expect(plan.map((x) => x.payload[0])).toEqual([0xb6, 0xb6, 0xb6]);
    expect(plan.every((x) => x.payload[1] === 0x01)).toBe(true);
  });
  it('RT change sends the switch then downstroke and upstroke', () => {
    const p = defaultProfile('A75Pro');
    p.rapidTrigger = true;
    const plan = planSync(p, 'oldHighPrec', new Set(['rapidTrigger']));
    expect(plan.map((x) => `${x.payload[0]!.toString(16)}:${x.payload[1]}`)).toEqual(['b5:0', 'b6:4', 'b6:4', 'b6:4', 'b6:5', 'b6:5', 'b6:5']);
    expect(plan[0]!.payload[8]).toBe(1);
  });
  it('Last Win uses clear → pairs → switch with both directions', () => {
    const p = defaultProfile('A75Pro');
    p.rapidTrigger = true;
    p.lastWin = { enabled: true, pairs: [[64, 66]] };
    const plan = planSync(p, 'oldHighPrec', new Set(['lastWin']));
    expect(plan.map((x) => x.payload[0])).toEqual([0xfc, 0xfc, 0xb5]);
    expect(plan[1]!.payload[3]).toBe(2);
    expect(plan[2]!.payload[10]).toBe(1);
    expect(directedPairs([[1, 2]])).toEqual([[1, 2], [2, 1]]);
  });
  it('remap writes 3 layers × 14 packets with the defaults on the base layer', () => {
    const p = defaultProfile('A75Pro');
    p.remap.base[63] = { cmd: 252, code: 1, type: 1 }; // Caps → LCtrl
    const plan = planSync(p, 'oldHighPrec', new Set(['remap']));
    expect(plan).toHaveLength(42);
    const caps = plan[7]!.payload; // slot 63 → packet 8 (index 7), entry 0
    expect(Array.from(caps.subarray(6, 12))).toEqual([63, 252, 1, 0, 0, 0]);
    const esc = plan[0]!.payload;
    expect(Array.from(esc.subarray(6, 12))).toEqual([0, 252, 0, 41, 0, 0]);
  });
});

describe('import/export', () => {
  it('round-trips DeerTune exports', () => {
    const p = defaultProfile('A75Pro', 'Valorant');
    p.ap[44] = 0.4;
    const [back] = importProfiles(JSON.parse(JSON.stringify(exportProfiles([p]))), 'A75Pro');
    expect(back?.name).toBe('Valorant');
    expect(back?.ap[44]).toBe(0.4);
    expect(back?.id).not.toBe(p.id);
  });
  it('imports official Antler profile files by keyname', () => {
    const antler = {
      storagename: 'ddeerA75ProProfile1',
      showname: 'From Antler',
      keys_array: [{ keyname: 'W', action_point: 0.3, downstroke: 0.15, upstroke: 0.2 }, { keyname: 'ESC', action_point: 1.5, downstroke: 0, upstroke: 0 }],
    };
    const [p] = importProfiles(antler, 'A75Pro');
    expect(p?.name).toBe('From Antler');
    expect(p?.ap[44]).toBe(0.3);
    expect(p?.ds[44]).toBe(0.15);
    expect(p?.ap[0]).toBe(1.5);
  });
  it('rejects unknown files', () => expect(() => importProfiles({ hello: 1 }, 'A75Pro')).toThrow());
});
