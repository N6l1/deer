# Logitech PRO X2 SUPERSTRIKE protocol (as used by DeerTune)

DeerTune talks to the PRO X2 SUPERSTRIKE with Logitech's HID++ 2.0 protocol over WebHID. Every request it can send is listed here. Anything else is refused by `checkHidpp` in `src/device/logitech/transport.ts`.

Sources:

| Tag | Source | How it was derived |
|---|---|---|
| **SOL** | [pwr-Solaar/Solaar](https://github.com/pwr-Solaar/Solaar) (GPL-2.0), `settings_templates.py`, `hidpp20.py`, and the device dump `docs/devices/PRO X 2 Superstrike 40BD.txt` | Linux Logitech manager; the 0x1B0C encoding was fixed after hardware testing (issue #3202). Facts only; no code was copied. |
| **KZ** | [kazehana99k/…SUPERSTRIKE…](https://github.com/kazehana99k/Logitech-PRO-X2-SUPERSTRIKE-Linux-haptics-actuation-control-) `PROTOCOL.md` | USB captures of G HUB, tested on one unit |

## Device

| | |
|---|---|
| Vendor ID | `0x046D` |
| LIGHTSPEED receiver | `0xC54D`. The mouse is **device index `0x01`** *(KZ)* |
| USB cable | `0xC0A8` (Solaar "usbid"). Device index `0xFF`; DeerTune falls back to `0x01` if that doesn't answer *(SOL, KZ)* |
| Wireless PID / protocol | WPID `40BD`, HID++ 4.2 *(SOL)* |
| Interface | vendor usage page `0xFF00`. DeerTune uses **long reports, report ID `0x11`** (20 bytes) *(KZ)* |

**Close Logitech G HUB first.** It holds the HID++ channel, and requests then fail with error `0x08` (busy) *(KZ)*.

## Framing

Request (19 bytes after the report ID): `[deviceIndex, featureIndex, fn << 4 | swid, params…]`. DeerTune's software ID is `0x0A`. Replies echo the first three bytes. An error reply is `[deviceIndex, FF, featureIndex, fn|swid, code]`, with codes 1 unknown, 2 invalid argument, 3 out of range, 4 hardware, 5 internal, 6 invalid feature index, 7 invalid function, 8 busy, 9 unsupported.

Feature indexes are looked up at run time with IRoot (`featureIndex 0`, fn 0, params `[idHi, idLo]` → `[index, type, version]`). Solaar's dump shows them as name `3`, battery `6`, DPI `9`, SUPERSTRIKE tuning `12`, report rate `13`, onboard profiles `14`, but DeerTune never assumes them.

## Requests DeerTune sends

| Feature | fn | Params → reply | Use |
|---|---|---|---|
| ROOT `0x0000` | 0 | `[idHi, idLo]` → `[index, …]` | find features (only the ones listed here) |
| DEVICE NAME `0x0005` | 0 / 1 | — → `[len]`; `[offset]` → ASCII | name |
| UNIFIED BATTERY `0x1004` | 1 | → `[percent, levelFlags, status]` | battery. Status 1, 2 or 4 = charging, 3 = full *(SOL)* |
| EXTENDED DPI `0x2202` | 5 | `[0]` → `[sensor, xHi, xLo, …, yHi, yLo, …, lod]` | current DPI, **read-only** *(SOL `dpi_extended`)* |
| EXTENDED REPORT RATE `0x8061` | 2 | → `[index]`, 0..6 = 125 … 8000 Hz | report rate, **read-only** *(SOL)* |
| ONBOARD PROFILES `0x8100` | 2 | → `[mode]`, 1 = onboard, 2 = host | shown only. DeerTune **never** sends fn 1 (mode switch) |
| **SUPERSTRIKE TUNING `0x1B0C`** | 0 | → `[flags, buttons=3, maxAct<<2 (0x28), maxRt<<2 (0x14), maxHaptics<<2 (0x14), …]` | capabilities. Only buttons 0 and 1 (left/right) are user-accessible *(SOL, KZ)* |
| | 2 | `[button]` → `[button, act, rt, haptics]` | read tuning |
| | **1** | `[button, act, rt, haptics]` | **write tuning** |

### Tuning byte encoding *(SOL, after the fix for issue #3202; matches KZ samples)*

- `act` = level × 4, with level 1 (shallowest) … 10 (deepest).
- `rt` = level × 4 **OR the firmware flag in bit 0**, which must be read and written back unchanged; level 1 … 5. (KZ's sample `0x09` = level 2 with the flag set.)
- `haptics` = level × 4, level 0 (off) … 5.
- Any other bit pattern is rejected by the mouse with INVALID_ARGUMENT. DeerTune's guard rejects it before sending.
- DeerTune always reads first, then writes, then reads back to confirm.

## Not implemented

- **DPI and report-rate writes**: these need the mouse switched from its onboard profile to host mode (0x8100 fn 1). That changes how the mouse behaves after sleep or replugging, and nobody has documented it for this mouse yet.
- **0x1B0C fn 3/4**: KZ saw fn 3 with `01 3c` / `00 3c`, possibly a global rapid-trigger toggle. Not decoded, so it's blocked.
- **Button remapping and onboard profile editing**: blocked.
- **DEVICE RESET (0x1802), FORCE PAIRING (0x1500), OOB STATE (0x1805)** and every feature not listed above: blocked.
