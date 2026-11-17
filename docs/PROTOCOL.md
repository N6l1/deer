# DrunkDeer HID protocol (as used by DeerTune)

This file covers every byte DeerTune sends or parses, where each fact comes from, and how sure we are.
**DeerTune refuses to send any packet that isn't described here** (see `src/device/guard.ts`).

Confidence levels:

- **Verified**: two or more independent sources agree, and at least one has tested it on A75 Pro hardware.
- **Agreed**: sources agree on the bytes, but nobody has confirmed the behaviour on an A75 Pro.
- **Conflicting**: sources disagree. DeerTune sends these only when *Allow experimental writes* is on. They need a WebHID capture to settle (see [CAPTURE.md](CAPTURE.md)).

Sources:

| Tag | Project | License | How it was derived |
|---|---|---|---|
| **CLI** | [2xxn/cli-drunkdeer](https://github.com/2xxn/cli-drunkdeer) | Apache-2.0 | Go CLI, used on real keyboards |
| **DDC** | [svumo/DrunkDeer-Control](https://github.com/svumo/DrunkDeer-Control) | MIT | Static analysis of the Antler JS bundle, plus WebHID captures and tests on an A75 Pro (firmware 0x09 and 0x17) |
| **DCTL** | [xuckless/deerctl](https://github.com/xuckless/deerctl) | MIT | Encoders checked byte-for-byte against the Antler JS; tested on a G65 |

## 1. Transport

- USB vendor ID `0x352D`. Product IDs used by Antler: `2382 2383 2384 2386 2387 238F 2390 2391 2394 23B3 23B4 23B5 23B6`. In macOS mode the A75 enumerates as `05AC:024F`. *(CLI, DDC)*
- Vendor HID interface: usage page `0xFF00`.
- Every message goes out as **output report `0x04`** with a 63-byte payload. Replies and streams come back as input report `0x04`. Most writes are echoed back with the same first byte. *(all three)*
- In this document, `p[n]` is the payload index, *after* the report ID.

## 2. Identity: `A0 02 00`, a query (Verified)

Request: `A0 02 00`, then zero padding. Reply (input report 4):

| Byte | Meaning |
|---|---|
| 0–2 | `A0 02 00` |
| 4–6 | model type triple (see below) |
| 7 / 8 | firmware low / high. Shown as `"0." + hi + lo` (fw `17 00` → `0.023`). The numeric value used for cutoffs is the decimal of the string `"<hi><lo>"`. |
| 15 | Turbo on |
| 16 | Rapid Trigger on |
| 18 | Release Dual-Trigger on |
| 19 | Last Win on |
| 30 | RT Match on |
| 31 | Auto-match mode (255 = off) |
| 32 | Last Win replace |

Model triples: A75 `0B 01 01` / `0B 04 01`, **A75 Pro `0B 04 03`**, G65 `0B 02 01` / `0F 01 01`, G60 `0B 03 01`, G75 `0B 04 05`. *(CLI, DDC, DCTL agree)*

**Read-back limits:** the A75 Pro firmware **cannot report per-key actuation, RT values, lighting or remaps**. The identity reply is the only state it gives back. That's why DeerTune keeps profiles on the host, and why the pre-write backup can't contain on-keyboard actuation values.

## 3. Actuation and RT sensitivity: `B6 <sub> 00 <chunk> …` (Verified)

| sub | Meaning |
|---|---|
| `01` | actuation point |
| `04` | RT downstroke (press sensitivity) |
| `05` | RT upstroke (release sensitivity) |

Three packets per write: chunk `0` = slots 0–58, chunk `1` = slots 59–117, chunk `2` = slots 118–125 (8 values). One byte per slot starting at `p[4]`. The remaining bytes are zero.

### Encoding "dialects" (important)

| Dialect | Used by | Byte scale | Actuation range | RT range | Step |
|---|---|---|---|---|---|
| legacy | A75 Pro firmware **< 0.017**, older A75 / G65 | mm × 10 (`0x14` = 2.0 mm) | 0.2–3.3 mm | 0–3.1 mm | 0.1 mm |
| old high precision | **A75 Pro firmware ≥ 0.017** (current 0.023) | mm × 100 (`0x14` = 0.2 mm, `0xC8` = 2.0 mm) | **0.2–2.0 mm** | 0–2.0 mm | 0.01 mm |

- The CLI's "`0x14` = 2.0 mm" is the legacy scale. DDC confirmed mm × 100 on A75 Pro firmware 0x17 by WebHID capture. DDC shipped the wrong scale for a while; the symptom was that every actuation setting acted like about 0.2 mm.
- On current firmware, Antler's own slider stops at 2.0 mm. The 3.8 mm in DrunkDeer's marketing doesn't apply to this protocol.
- Per-model cutoffs (DCTL `_HP_FROM`, decimal firmware number): A75 35, **A75 Pro 17**, A75 ISO 25, G65 19, G60 21, G75 13. DeerTune picks the dialect from the identity reply.

## 4. Mode switches: `B5 00 1E 01 00 00 01 <turbo> <rt> 00 <lw|rdt> <rtMatch>` (Verified for Turbo/RT)

`p[10]` is an enum: 0 = none, 1 = Last Win, 2 = Release Dual-Trigger, 3 = both. The firmware doesn't check combinations. Antler enforces these couplings in its UI, and DeerTune copies them:

- Turbo and keystroke tracking are mutually exclusive.
- Turning on Last Win or Dual-Trigger forces RT on and Turbo off.

The guard marks this packet *experimental* whenever `p[10] ≠ 0`.

## 5. Keystroke tracking

- Enable / disable: `B6 03 <1|0>` (CLI). **Agreed.** DDC notes that newer high-precision boards use `FD 03`, which DeerTune does not send.
- Stream: input `B7 ?? ?? <chunk> <depth…>`, using the same 59 / 59 / 8 chunking. Depth = byte ÷ 10 (legacy) or ÷ 100 (old high precision). DDC's working parser reads the chunk at `p[3]`; one of DDC's notes says `p[2]`. Needs a capture.

## 6. Lighting: `AE 01 00 00 <mode> <speed> <brightness> <colour>` (Verified for Off/Always/Breath)

- `speed` and `brightness` are **0–9**. DDC reports that brightness ≥ 10 can soft-brick an A75 Pro, so DeerTune clamps both in the builder and rejects them again in the guard.
- `colour`: 0 = rainbow/default, 1 red, 2 green, 3 blue, 4 yellow, 5 purple, 6 cyan, 7 white. Effects can't use arbitrary RGB; only Custom mode can. *(DCTL, DDC)* The CLI sends `0xFF` here; the other two sources send `0`–`7`.
- `p[3]`: the CLI calls this "direction", but Antler always sends 0. **Conflicting.** DeerTune always sends 0 and shows Direction as "needs capture".
- Mode codes for the A75 family (index in the model's colour table minus 2): Off 0, Rotate Marquee 1, Always On 2, Spectrum 3, Breath 4, Light by Press 5, Stars 6, Wave Spectrum 7, Center Surf 8, Surf Down 9, Ripple 10, Glowing Fish 11, Fountain 12, Traffic 13, Snake 14, Surf Repeat 15, Surf Cross 16, Laser Key 17, Random Fountain 18, **Custom 19**. *(CLI constants and DCTL formula agree)*

### Custom per-key colours (Agreed)

7 packets for the A75 family (6 for G60/G65), each `AE 01 00 00 13 06 <brightness> FF`, then up to 13 entries of `[0x80 + slot, R, G, B]`, terminated by `FF`. The packet count is fixed; empty trailing packets carry just the terminator. These packets are not acknowledged.

## 7. Keymap: `A0 02 04 <pkt 1–14> 0E <layer> …` (Conflicting: experimental)

Layers: 1 = base, 2 = Fn, 3 = Fn2. There are 14 packets per layer, and each holds 9 slots: `[slot, cmd, a, b, 0, 0]` at `p[6 + 6·w]`, with `p[60] = A5`.

| type | 5-byte target after the slot |
|---|---|
| 0, plain HID key | `FC 00 <usage> 00 00` |
| 1, modifier bitmask | `FC <mask> 00 00 00` (LCtrl 1, LShift 2, LAlt 4, RCtrl 16, RShift 32, RAlt 64, RWin 128; LWin is type 0 usage 227) |
| 2, keyboard function | `FB <fn> 00 00 00` (LED and Win-lock), `FD 20` = RT toggle |
| 3, media / mouse | `<code> 00 00 00 00` (media 144–150, mouse 176–184) |

**Conflict:** DCTL writes entries at fixed offsets and leaves zeroed gaps for empty slots; this was tested on a G65. DDC packs entries with no gaps and also sends `AA 00 01` and `A7`/`A8` "RT authority" packets to commit remaps. DeerTune follows DCTL, always writes all 3 layers (42 packets), and fills the base layer with the model defaults. It **never sends `AA`, `A7` or `A8`**. Remapping needs a capture before it can be trusted.

## 8. Last Win and Release Dual-Trigger (Conflicting: experimental)

- Clear pair table: `FC 0A <mode>` (mode enum as in §4).
- Last Win pairs: `FC 01 00 <n>` then `[main, trigger, 0, 0]` × n, at most 14. Each direction is a separate entry (A⇄D = `40 42` and `42 40`).
- Dual-Trigger pairs: `FC 03 <n>` then `[press, release, activeLo, activeHi, resetLo, resetHi, 0, 0]` × n. Thresholds are mm × 200 (active 0.05–0.25 mm, reset 1.5–2.5 mm).
- DeerTune's order is clear → pairs → `B5` switch.
- **Conflict:** DDC found that this sequence alone was acknowledged but didn't activate Last Win on early firmware. It also reverses itself on whether `FC 03` is sent at all. Capture needed.

## 9. Knob: `C1 03 <event 1–6> <bind> 00 <target>` (Conflicting: experimental)

For type 0 the target is `p[5] = cmd, p[7] = code`; for types 1/2 it's `p[6] = code`; for type 3 it's `p[5] = cmd` only. The meaning of events 1–6 (rotate left/right, press, per knob?) isn't confirmed. The A75 Pro's knob isn't part of the 126-slot matrix.

## 10. Opcodes DeerTune will not send

| Opcode | Why |
|---|---|
| `AA` | `AA 00` is **factory reset**, and `AA 00 01` is a "clear RT upper" sentinel. The same opcode is destructive, so it's blocked completely. |
| `AB` | delete onboard profile |
| `A2`, `FB` | onboard profile count / switch (not used by the A75 Pro) |
| `A7`, `A8` | "RT authority" remap commit (unverified) |
| `FD` | high-precision dialect (A75 Ultra / Master only) |
| anything else | not on the allow-list |

No firmware flashing code exists in DeerTune.

## 11. A75 / A75 Pro key index map

The firmware uses a 6 × 21 = 126 slot grid. The A75 Pro has 82 keys, plus a knob that isn't a matrix slot. Slot 56 appears in Antler's default keymap with no label (probably an ISO-only position); it isn't drawn.

| Slot | Key | Antler `keyname` | Default cmd / code / type |
|---:|---|---|---|
| 0 | Esc | `ESC` | 252 / 41 / 0 |
| 2 | F1 | `F1` | 252 / 58 / 0 |
| 3 | F2 | `F2` | 252 / 59 / 0 |
| 4 | F3 | `F3` | 252 / 60 / 0 |
| 5 | F4 | `F4` | 252 / 61 / 0 |
| 6 | F5 | `F5` | 252 / 62 / 0 |
| 7 | F6 | `F6` | 252 / 63 / 0 |
| 8 | F7 | `F7` | 252 / 64 / 0 |
| 9 | F8 | `F8` | 252 / 65 / 0 |
| 10 | F9 | `F9` | 252 / 66 / 0 |
| 11 | F10 | `F10` | 252 / 67 / 0 |
| 12 | F11 | `F11` | 252 / 68 / 0 |
| 13 | F12 | `F12` | 252 / 69 / 0 |
| 14 | Del | `KP7` | 252 / 76 / 0 |
| 21 | ` | `SWUNG` | 252 / 53 / 0 |
| 22 | 1 | `1` | 252 / 30 / 0 |
| 23 | 2 | `2` | 252 / 31 / 0 |
| 24 | 3 | `3` | 252 / 32 / 0 |
| 25 | 4 | `4` | 252 / 33 / 0 |
| 26 | 5 | `5` | 252 / 34 / 0 |
| 27 | 6 | `6` | 252 / 35 / 0 |
| 28 | 7 | `7` | 252 / 36 / 0 |
| 29 | 8 | `8` | 252 / 37 / 0 |
| 30 | 9 | `9` | 252 / 38 / 0 |
| 31 | 0 | `0` | 252 / 39 / 0 |
| 32 | - | `MINUS` | 252 / 45 / 0 |
| 33 | = | `PLUS` | 252 / 46 / 0 |
| 34 | Backspace | `BACK` | 252 / 42 / 0 |
| 36 | Home | `KP5` | 252 / 74 / 0 |
| 42 | Tab | `TAB` | 252 / 43 / 0 |
| 43 | Q | `Q` | 252 / 20 / 0 |
| 44 | W | `W` | 252 / 26 / 0 |
| 45 | E | `E` | 252 / 8 / 0 |
| 46 | R | `R` | 252 / 21 / 0 |
| 47 | T | `T` | 252 / 23 / 0 |
| 48 | Y | `Y` | 252 / 28 / 0 |
| 49 | U | `U` | 252 / 24 / 0 |
| 50 | I | `I` | 252 / 12 / 0 |
| 51 | O | `O` | 252 / 18 / 0 |
| 52 | P | `P` | 252 / 19 / 0 |
| 53 | [ | `BRKTS_L` | 252 / 47 / 0 |
| 54 | ] | `BRKTS_R` | 252 / 48 / 0 |
| 55 | \ | `SLASH_K29` | 252 / 49 / 0 |
| 57 | PgUp | `KP2` | 252 / 75 / 0 |
| 63 | Caps | `CAPS` | 252 / 57 / 0 |
| 64 | A | `A` | 252 / 4 / 0 |
| 65 | S | `S` | 252 / 22 / 0 |
| 66 | D | `D` | 252 / 7 / 0 |
| 67 | F | `F` | 252 / 9 / 0 |
| 68 | G | `G` | 252 / 10 / 0 |
| 69 | H | `H` | 252 / 11 / 0 |
| 70 | J | `J` | 252 / 13 / 0 |
| 71 | K | `K` | 252 / 14 / 0 |
| 72 | L | `L` | 252 / 15 / 0 |
| 73 | ; | `COLON` | 252 / 51 / 0 |
| 74 | ' | `QOTATN` | 252 / 52 / 0 |
| 76 | Enter | `RETURN` | 252 / 40 / 0 |
| 78 | PgDn | `KP0` | 252 / 78 / 0 |
| 84 | Shift | `SHF_L` | 252 / 2 / 1 |
| 86 | Z | `Z` | 252 / 29 / 0 |
| 87 | X | `X` | 252 / 27 / 0 |
| 88 | C | `C` | 252 / 6 / 0 |
| 89 | V | `V` | 252 / 25 / 0 |
| 90 | B | `B` | 252 / 5 / 0 |
| 91 | N | `N` | 252 / 17 / 0 |
| 92 | M | `M` | 252 / 16 / 0 |
| 93 | , | `COMMA` | 252 / 54 / 0 |
| 94 | . | `PERIOD` | 252 / 55 / 0 |
| 95 | / | `VIRGUE` | 252 / 56 / 0 |
| 97 | Shift | `SHF_R` | 252 / 32 / 1 |
| 98 | ↑ | `ARR_UP` | 252 / 82 / 0 |
| 100 | End | `NUMS` | 252 / 77 / 0 |
| 105 | Ctrl | `CTRL_L` | 252 / 1 / 1 |
| 106 | Win | `WIN_L` | 252 / 227 / 0 |
| 107 | Alt | `ALT_L` | 252 / 4 / 1 |
| 111 | Space | `SPACE` | 252 / 44 / 0 |
| 115 | Alt | `ALT_R` | 252 / 64 / 1 |
| 116 | Fn | `FN1` | 255 / 255 / 3 |
| 117 | Fn2 | `APP` | 254 / 254 / 3 |
| 119 | ← | `ARR_DW` | 252 / 80 / 0 |
| 120 | ↓ | `ARR_R` | 252 / 81 / 0 |
| 121 | → | `CTRL_R` | 252 / 79 / 0 |

Quick-select presets (CLI): WASD `44 64 65 66`; Numerals `22–31`; Character `43–52, 64–72, 86–92`.

## 12. Open questions (send a capture)

1. Lighting `p[3]` (direction) on A75 Pro firmware 0.023.
2. Whether the tracking stream chunk index sits at `p[2]` or `p[3]`.
3. Keymap entry packing (fixed offsets vs packed), and whether Antler sends `AA 00 01` / `A7` / `A8` after a plain remap.
4. The full Last Win and Dual-Trigger save sequences on firmware 0.023.
5. Knob event IDs and which events exist on the A75 Pro.
6. Whether `B6 03` or `FD 03` turns on tracking on firmware 0.023.
