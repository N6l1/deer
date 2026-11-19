# Razer Viper V4 Pro protocol (as used by DeerTune)

DeerTune's Mouse tab talks to the Razer Viper V4 Pro over WebHID using Razer's standard control report. Every byte DeerTune sends is listed below. Anything else is refused by `src/device/razer/guard.ts`.

Sources:

| Tag | Source | How it was derived |
|---|---|---|
| **OR** | [openrazer/openrazer](https://github.com/openrazer/openrazer) driver (GPL-2.0), `razermouse_driver.c` / `razerchromacommon.c` | Linux kernel driver with Viper V4 Pro support (PIDs `00E5`/`00E6`). DeerTune uses its facts only; no code was copied. |
| **CAP** | [openrazer#2760](https://github.com/openrazer/openrazer/issues/2760) | Decoded Synapse 4 USB capture from a Viper V4 Pro on firmware 1.1.1.0, wired and through the dongle |

## Device

| | |
|---|---|
| Vendor ID | `0x1532` |
| Product ID | `0x00E5` wired, `0x00E6` HyperSpeed dongle *(OR, CAP)* |
| Control channel | USB interface 3: a Consumer-control (`0x0C/0x01`) collection containing a vendor (`0xFF00`) 90-byte **feature report with no report ID** *(CAP descriptor `05 0C 09 01 A1 01 06 00 FF 09 02 … 95 5A B1 02 C0`)* |
| Transaction ID | `0x1F` *(OR)* |

Chrome on Windows blocks web pages from reaching HID collections it recognises as a mouse or keyboard. The V4 Pro's control report sits under a Consumer collection, which isn't one of those, so it should be reachable from the browser. This hasn't been tested on Windows Chrome 153 or later. If the browser hides it, DeerTune says so.

## Report format (90 bytes, sent with `sendFeatureReport(0, …)`)

| Byte | Field |
|---|---|
| 0 | status: `00` in requests. Replies use `01` busy, `02` ok, `03` failure, `04` timeout (mouse asleep or off), `05` not supported |
| 1 | transaction ID `1F` |
| 2–3 | remaining packets (big-endian), `00 00` |
| 4 | protocol type `00` |
| 5 | data size |
| 6 | command class |
| 7 | command ID |
| 8–87 | arguments |
| 88 | checksum: XOR of bytes 2–87 |
| 89 | `00` |

The reply is read with `receiveFeatureReport(0)` after about 5 ms (wired) or 60 ms (dongle). A `01` (busy) reply is polled again; CAP notes wireless writes often return busy before ok. Some browsers put the report-ID byte in front of the reply; DeerTune accepts both forms.

## Commands DeerTune sends

| Class / ID | Size | Arguments | Meaning |
|---|---|---|---|
| `00 81` | 2 | — | read firmware: reply args `[major, minor]` |
| `00 82` | 0x16 | — | read serial (ASCII) |
| `00 C0` | 1 | — | read polling rate: reply `args[1]` |
| `00 40` | 2 | `[00, code]` then `[01, code]` | **set polling rate.** Codes: 125 Hz `40`, 500 `10`, 1000 `08`, 2000 `04`, 4000 `02`, 8000 `01`. OR sends it twice with arg 0 and arg 1; CAP doesn't mention this. |
| `04 85` | 7 | `[00]` | read current DPI: `[_, xHi, xLo, yHi, yLo]` |
| `04 86` | 0x26 | `[01]` | read DPI stages: `[01, active, count, (id, xHi, xLo, yHi, yLo, 0, 0) × count]` |
| `04 06` | 0x26 | same layout | **set DPI stages** (1–5 stages, DPI 100–50 000, active stage 1-based). CAP shows Synapse sets DPI only this way, so DeerTune does too. Stage IDs are written exactly as the mouse reports them. |
| `07 80` | 2 | — | read battery: `args[1]` / 255 |
| `07 84` | 2 | — | read charging: `args[1]` ≠ 0 |
| `07 83` | 2 | — | read sleep timer (big-endian seconds) |
| `07 03` | 2 | `[sHi, sLo]` | **set sleep timer**, 60–900 s |
| `07 81` | 1 | — | read low-battery threshold (0–255 scale) |
| `07 01` | 1 | `[raw]` | **set low-battery threshold**, `0x0C`–`0x3F` (about 5–25 %). CAP says the mouse accepts up to `0xFF`; DeerTune keeps to the range both sources agree on. |

## Not implemented (no published bytes yet)

- **Button remapping**: CAP says it uses the same report format but doesn't publish the class, ID or arguments.
- **Dongle LED indicators** (`07 15` / `07 95`): one mode value in CAP is inferred, not confirmed.
- **Device mode** (`00 04`) and anything else are blocked by the guard.

## Safety

- The allow-list covers only the class/ID pairs above, plus range checks and checksum verification.
- Dry-run (on by default) logs writes without sending them.
- Before the first real write, DeerTune downloads a JSON backup of everything it read from the mouse.
- After every write, DeerTune reads the settings back and tells you whether they match.
