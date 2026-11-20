# MADLIONS MAD68 HE protocol (as used by DeerTune)

DeerTune's **MAD 68 HE** tab talks to the keyboard over WebHID, using the same channel as the official configurator at hub.fgg.com.cn. Every report DeerTune can send is listed here. Anything else is refused by `checkMad` in `src/device/madlions/transport.ts`.

Main source: [NasirA1991/madlions-control](https://github.com/NasirA1991/madlions-control) (MIT), `docs/PROTOCOL.md` and `madlions_control/device.py`. Its author verified everything below on a **MAD68 HE RGB (`373B:1058`), firmware protocol 9**, including writes and read-back. Cross-checked against [OpenMAD](https://github.com/acciaw/OpenMAD) board reports, which show the same 5×15 matrix and protocol 9 on `1057` and `105C`.

## Device

| | |
|---|---|
| Vendor ID | `0x373B` |
| Boards | `1058` MAD68 HE RGB (**verified**), `1057` MAD68 HE, `1059` Ultra, `105A` / `105C` Limited (same controller, not verified) |
| Interface | vendor collection, usage page `0xFF60`, usage `0x61` (VIA raw HID) |
| Reports | 32 bytes, **no report ID**. Some firmware builds prefix a `00` on replies; DeerTune strips it. |
| Matrix | 5 × 15 = 75 cells, 68 keys. Empty cells: (2,12), (3,1), (4,3), (4,4), (4,5), (4,7), (4,8). Key index = `row × 15 + col` |

Writes are refused unless the keyboard reports **protocol 9**, and on unverified boards unless *Allow experimental writes* is on. This is the same policy madlions-control uses.

## Reports DeerTune sends

| Bytes | Meaning |
|---|---|
| `01` | protocol version. Reply `01 00 09` |
| `02 96 0D 00 00 offHi offLo n` | read actuation, n ≤ 12. Reply echoes offset at [5:7] and count at [7]; data from [8], u16 BE in 0.01 mm |
| `02 96 0E 00 00 offHi offLo n` | read rapid trigger, n ≤ 4. 5 bytes per key: `enabled, release u16, press u16` |
| `02 96 17 00 00 offHi offLo n` | read live travel, n ≤ 12. u16 BE in 0.01 mm, 0 at rest. Polled about every 60 ms for the live view |
| `08 41` | read lighting. Reply: effect [2], speed [4], R G B [5..7], brightness [8] |
| `03 96 0D 00 00 offHi offLo n FLASH data…` | **write actuation**, n ≤ 11, values 0.05–3.40 mm |
| `03 96 0E 00 00 offHi offLo n FLASH data…` | **write rapid trigger**, n ≤ 4 |
| `07 41 effect 00 speed R G B brightness` | **set lighting**, speed 1–255, brightness 0–210 (the firmware ignores higher values) |
| `03 96 12` | **save lighting** to flash |

`FLASH` is `00` (apply live) or `03` (erase and write flash). DeerTune saves the way madlions-control's `commit()` does: it rewrites the **whole** 75-entry table with `03`, so a flash erase can't leave other keys with stale values. When the effect is Off, the firmware ignores colour and brightness, so DeerTune first sets them with Solid colour and then switches to Off (madlions-control does the same).

Colour read-back is gamma-corrected and may not exactly equal the colour written.

## Not implemented (blocked by the guard)

- Keymaps (`04`/`05`/`12`/`13`), macros (`0C`–`0F`), per-key colours (`96 42`/`45`).
- Features, dead band, game mode, advanced keys / SOCD / DKS, tap-hold (`FE` prefix).
- Calibration (`96 1F`), EEPROM reset, bootloader, firmware.

## Effect numbers

0 Off, 2 Solid, 3 Focus, 4/5 Rainbow, 6 Breathing, 7/8 Ribbon, 9/11 Rotating belt, 13 Spectrum cycle, 19/23 Colour swirl, 25 Christmas, 26 Spectrum breathing, 28 Spectrum floating, 30 Digital rain, 31 Lighting up, 36 Crucifix, 39 Fingertip rainbow (madlions-control `lighting.py`, taken from the vendor's own table). Effect 1 (Custom per-key) isn't offered because per-key colour writes aren't implemented.
