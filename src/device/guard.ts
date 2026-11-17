// Outgoing packet allow-list. Every packet passes through `checkPacket` before it can reach the device.
// Anything not explicitly recognised here is rejected. See docs/PROTOCOL.md §Safety.

import { LED_LEVEL_MAX, OP, PAYLOAD_SIZE, SLOT_COUNT } from './constants';

export type PacketClass = 'query' | 'write' | 'experimental';

export interface GuardLimits {
  /** max raw byte for actuation (dialect-dependent) */
  apMaxByte: number;
  apMinByte: number;
  /** max raw byte for RT down/upstroke */
  rtMaxByte: number;
  /** allowed LED mode codes for the connected model (excluding custom) */
  ledModes: number[];
  customLedMode: number;
}

export type GuardResult = { ok: true; cls: PacketClass; label: string } | { ok: false; reason: string };

/** Opcodes we will never send, with the reason. Checked first so the message is explicit. */
export const BLOCKED: Record<number, string> = {
  0xaa: 'factory reset / clear (0xAA) — destructive',
  0xab: 'delete onboard profile (0xAB) — destructive',
  0xa2: 'onboard profile count (0xA2) — not verified',
  0xa7: 'RT authority (0xA7) — not verified',
  0xa8: 'RT authority download (0xA8) — not verified',
  0xfb: 'onboard profile switch (0xFB) — not verified',
  0xfd: 'high-precision dialect (0xFD) — not used by the A75 family',
};

const zeroFrom = (p: Uint8Array, from: number) => p.subarray(from).every((b) => b === 0);
const isBool = (b: number | undefined) => b === 0 || b === 1;

export function checkPacket(p: Uint8Array, lim: GuardLimits): GuardResult {
  if (p.length !== PAYLOAD_SIZE) return { ok: false, reason: `payload must be ${PAYLOAD_SIZE} bytes, got ${p.length}` };
  const [op, sub] = [p[0] ?? 0, p[1] ?? 0];
  const blocked = BLOCKED[op];
  if (blocked) return { ok: false, reason: `blocked opcode: ${blocked}` };
  const fail = (reason: string): GuardResult => ({ ok: false, reason: `0x${op.toString(16)} ${reason}` });

  switch (op) {
    case OP.IDENTITY: {
      if (sub !== 0x02) return fail('unknown sub-command');
      if (p[2] === 0x00) return zeroFrom(p, 3) ? { ok: true, cls: 'query', label: 'identity query' } : fail('identity query must be zero-padded');
      if (p[2] === 0x04) {
        const n = p[3] ?? 0;
        const layer = p[5] ?? 0;
        if (n < 1 || n > 14 || p[4] !== 0x0e || layer < 1 || layer > 3 || p[60] !== 0xa5) return fail('malformed keymap packet');
        for (let w = 0; w < 9; w++) {
          const off = 6 + w * 6;
          const slot = p[off] ?? 0;
          const used = p.subarray(off, off + 6).some((b) => b !== 0);
          if (used && slot !== (n - 1) * 9 + w) return fail(`keymap entry ${w} has slot ${slot}, expected ${(n - 1) * 9 + w}`);
        }
        return { ok: true, cls: 'experimental', label: `keymap layer ${layer} pkt ${n}` };
      }
      return fail('unknown identity mode');
    }
    case OP.COMMON_SWITCH: {
      const head = [0x00, 0x1e, 0x01, 0x00, 0x00, 0x01];
      if (!head.every((b, i) => p[1 + i] === b)) return fail('bad header');
      if (!isBool(p[7]) || !isBool(p[8]) || p[9] !== 0 || (p[10] ?? 9) > 3 || !isBool(p[11]) || !zeroFrom(p, 12)) return fail('bad switch values');
      return { ok: true, cls: (p[10] ?? 0) > 0 ? 'experimental' : 'write', label: 'common switch' };
    }
    case OP.TRAVEL: {
      if (sub === 0x03) return isBool(p[2]) && zeroFrom(p, 3) ? { ok: true, cls: 'write', label: `tracking ${p[2] ? 'on' : 'off'}` } : fail('bad tracking packet');
      if (sub !== 0x01 && sub !== 0x04 && sub !== 0x05) return fail('unknown travel sub-command');
      const chunk = p[3] ?? 9;
      if (p[2] !== 0 || chunk > 2) return fail('bad travel chunk');
      const n = chunk < 2 ? 59 : 8;
      const max = sub === 0x01 ? lim.apMaxByte : lim.rtMaxByte;
      const min = sub === 0x01 ? lim.apMinByte : 0;
      for (let k = 0; k < n; k++) {
        const v = p[4 + k] ?? 0;
        if (v > max || v < min) return fail(`value ${v} at slot ${chunk * 59 + k} outside ${min}..${max}`);
      }
      if (!zeroFrom(p, 4 + n)) return fail('travel padding must be zero');
      return { ok: true, cls: 'write', label: `${{ 1: 'actuation', 4: 'downstroke', 5: 'upstroke' }[sub]} chunk ${chunk}` };
    }
    case OP.LED: {
      if (sub !== 0x01 || p[2] !== 0 || p[3] !== 0) return fail('bad LED header');
      const mode = p[4] ?? 0;
      if (mode === lim.customLedMode) {
        if (p[5] !== 0x06 || (p[6] ?? 99) > LED_LEVEL_MAX || p[7] !== 0xff) return fail('bad custom LED header');
        let i = 8;
        for (let k = 0; k < 13 && (p[i] ?? 0) !== 0xff; k++, i += 4) {
          const s = (p[i] ?? 0) - 0x80;
          if (s < 0 || s >= SLOT_COUNT) return fail(`bad custom LED slot byte ${p[i]}`);
        }
        if (p[i] !== 0xff || !zeroFrom(p, i + 1)) return fail('custom LED stream must end with FF');
        return { ok: true, cls: 'write', label: 'custom LED colours' };
      }
      if (!lim.ledModes.includes(mode)) return fail(`LED mode ${mode} not in this model's table`);
      if ((p[5] ?? 99) > LED_LEVEL_MAX || (p[6] ?? 99) > LED_LEVEL_MAX) return fail('LED speed/brightness must be 0..9');
      if ((p[7] ?? 99) > 7 || !zeroFrom(p, 8)) return fail('LED colour index must be 0..7');
      return { ok: true, cls: 'write', label: `LED mode ${mode}` };
    }
    case OP.PAIRS: {
      if (sub === 0x0a) return (p[2] ?? 9) <= 3 && zeroFrom(p, 3) ? { ok: true, cls: 'experimental', label: 'clear pairs' } : fail('bad clear');
      if (sub === 0x01) {
        const n = p[3] ?? 99;
        if (p[2] !== 0 || n > 14) return fail('bad Last Win pair count');
        for (let i = 0; i < n; i++) if ((p[4 + i * 4] ?? 255) >= SLOT_COUNT || (p[5 + i * 4] ?? 255) >= SLOT_COUNT) return fail('bad Last Win slot');
        return zeroFrom(p, 4 + n * 4) ? { ok: true, cls: 'experimental', label: `Last Win pairs ×${n}` } : fail('bad padding');
      }
      if (sub === 0x03) {
        const n = p[2] ?? 99;
        if (n > 7) return fail('bad RDT pair count');
        return zeroFrom(p, 3 + n * 8) ? { ok: true, cls: 'experimental', label: `RDT pairs ×${n}` } : fail('bad padding');
      }
      return fail('unknown pair sub-command');
    }
    case OP.KNOB: {
      if (sub !== 0x03 || (p[2] ?? 0) < 1 || (p[2] ?? 0) > 6 || !isBool(p[3]) || p[4] !== 0 || !zeroFrom(p, 8)) return fail('bad knob packet');
      return { ok: true, cls: 'experimental', label: `knob event ${p[2]}` };
    }
    default:
      return fail('opcode is not on the allow-list');
  }
}
