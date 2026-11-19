// Allow-list for Razer reports. Only these command class/ID pairs can ever reach the mouse.

import { crc, REPORT_SIZE, TRANSACTION_ID, POLL_CODES, type RazerModel } from './protocol';

export type RazerClass = 'query' | 'write';
export type RazerGuardResult = { ok: true; cls: RazerClass; label: string } | { ok: false; reason: string };

const READS: Record<string, string> = {
  '00:81': 'read firmware', '00:82': 'read serial', '00:c0': 'read polling rate', '04:85': 'read DPI',
  '04:86': 'read DPI stages', '07:80': 'read battery', '07:84': 'read charging', '07:83': 'read sleep timer', '07:81': 'read low-battery threshold',
};

const key = (c: number, i: number) => `${c.toString(16).padStart(2, '0')}:${i.toString(16).padStart(2, '0')}`;

export function checkRazerReport(r: Uint8Array, model: RazerModel): RazerGuardResult {
  if (r.length !== REPORT_SIZE) return { ok: false, reason: `report must be ${REPORT_SIZE} bytes` };
  if (r[0] !== 0 || r[1] !== TRANSACTION_ID || r[2] !== 0 || r[3] !== 0 || r[4] !== 0 || r[89] !== 0) return { ok: false, reason: 'bad report header' };
  if (r[88] !== crc(r)) return { ok: false, reason: 'bad checksum' };
  const [size, cls, id] = [r[5] ?? 0, r[6] ?? 0, r[7] ?? 0];
  const a = (i: number) => r[8 + i] ?? 0;
  const k = key(cls, id);
  const rest0 = (from: number) => r.subarray(8 + from, 88).every((b) => b === 0);
  const fail = (why: string): RazerGuardResult => ({ ok: false, reason: `${k} ${why}` });

  const read = READS[k];
  if (read) return { ok: true, cls: 'query', label: read };

  switch (k) {
    case '00:40': {
      if (size !== 2 || (a(0) !== 0 && a(0) !== 1) || !Object.values(POLL_CODES).includes(a(1)) || !rest0(2)) return fail('bad polling-rate value');
      return { ok: true, cls: 'write', label: `polling rate (arg ${a(0)})` };
    }
    case '04:06': {
      const count = a(2);
      if (size !== 0x26 || a(0) !== 1 || count < 1 || count > model.maxStages || a(1) < 1 || a(1) > count) return fail('bad DPI stage header');
      for (let i = 0; i < count; i++) {
        const o = 3 + i * 7;
        const x = (a(o + 1) << 8) | a(o + 2);
        const y = (a(o + 3) << 8) | a(o + 4);
        if (x < model.dpiMin || x > model.dpiMax || y < model.dpiMin || y > model.dpiMax) return fail(`stage ${i + 1} DPI out of range`);
        if (a(o + 5) !== 0 || a(o + 6) !== 0) return fail('reserved stage bytes must be zero');
      }
      return rest0(3 + count * 7) ? { ok: true, cls: 'write', label: `DPI stages ×${count}` } : fail('bad padding');
    }
    case '07:03': {
      const s = (a(0) << 8) | a(1);
      return size === 2 && s >= 60 && s <= 900 && rest0(2) ? { ok: true, cls: 'write', label: `sleep after ${s} s` } : fail('sleep timer must be 60..900 s');
    }
    case '07:01':
      return size === 1 && a(0) >= 0x0c && a(0) <= 0x3f && rest0(1) ? { ok: true, cls: 'write', label: 'low-battery threshold' } : fail('threshold must be 0x0C..0x3F');
    default:
      return fail('command is not on the allow-list');
  }
}
