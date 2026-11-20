# DeerTune

**An open-source configurator for DrunkDeer and MADLIONS magnetic keyboards (plus the Razer Viper V4 Pro, Logitech PRO X2 SUPERSTRIKE and PRO X SUPERLIGHT 2 mice) that runs in your browser.** It talks to the keyboard directly over WebHID, installs as an offline app, and keeps your profiles on your own machine.

**Live app:** https://n6l1.github.io/deer/ · [User manual](docs/USER_MANUAL.md) · [Protocol notes](docs/PROTOCOL.md) · [Help verify the protocol](docs/CAPTURE.md)

> **Unofficial. Use at your own risk.** DeerTune isn't affiliated with or endorsed by DrunkDeer. The protocol was pieced together from community reverse-engineering. Dry-run mode is on by default, and the app downloads a backup before its first real write. DeerTune never flashes firmware.

## Features

| Area | What you get | Status on A75 Pro |
|---|---|---|
| Connection | WebHID picker filtered to DrunkDeer's vendor interface; model and firmware detection | ✅ |
| Performance | Accurate 75% key map with knob, click / Ctrl / Shift / drag selection, WASD / All / Character / Numerals presets, vertical action-point slider with arrow-key fine tuning | ✅ |
| Rapid Trigger | Per-key press and release sensitivity | ✅ |
| Turbo, keystroke tracking | Toggles plus a live travel view (keycaps fill with depth, and a per-key graph with actuation and reset lines) | ✅ |
| Lighting | All effects, brightness, speed, preset colours, live preview | ✅ (direction byte needs a capture) |
| Custom per-key RGB | Brush with colour wheel and hex input, fill all, eyedropper | ✅ |
| Last Win (SOCD), Release Dual-Trigger | Pair editors, thresholds | 🧪 experimental |
| Remap | Base / Fn / Fn2 layers; letters, modifiers, F-keys, media, mouse, keyboard functions, disable; knob | 🧪 experimental |
| MAD 68 HE tab | MADLIONS MAD68 HE: per-key actuation (0.05–3.40 mm) and rapid trigger, live key travel, Windows / Mac layout switch, SOCD pairs (last input / key 1 / key 2 / neutral), lighting effect / brightness / speed / colour, saved to flash with read-back | ✅ on 1058 RGB; other variants experimental |
| Mouse tab | Razer Viper V4 Pro, wired or via dongle: battery, DPI stages (up to 5, X/Y), polling rate up to 8 kHz, sleep timer, low-battery warning; read back after every write | ✅ (button remap not yet) |
| Logitech PRO X2 SUPERSTRIKE / PRO X SUPERLIGHT 2 | Polling rate (125 Hz–8 kHz, as the mouse supports) with onboard ↔ software mode switch; SUPERSTRIKE click tuning per button (actuation 1–10, rapid trigger 1–5, haptics 0–5); battery; DPI shown read-only | ✅ (DPI editing not yet) |
| Profiles | Add, rename, duplicate, delete, import/export JSON (also imports official driver profiles), IndexedDB storage | ✅ |
| App | Installable offline PWA, dark and light themes, English and Arabic (RTL) | ✅ |
| Safety | Opcode allow-list, value range checks, dry-run, packet preview before every save, automatic pre-write backup | ✅ |

🧪 **experimental** features are only sent when you turn on *Settings → Allow experimental writes*. Their byte formats conflict between the reference projects. A capture from the official driver ([CAPTURE.md](docs/CAPTURE.md)) will settle them.

## Supported models

| Model | Detect | Layout | Writes |
|---|---|---|---|
| A75 Pro | ✅ | exact | ✅ |
| A75 | ✅ | exact | ✅ |
| G65, G60, G75 | ✅ | approximate | read-only until someone tests one |
| Razer Viper V4 Pro (mouse) | ✅ | — | ✅ DPI, polling, power. See [PROTOCOL-RAZER.md](docs/PROTOCOL-RAZER.md) |
| MADLIONS MAD68 HE (RGB / Lightless / Ultra / Limited) | ✅ | exact | ✅ RGB (1058); others behind experimental. See [PROTOCOL-MADLIONS.md](docs/PROTOCOL-MADLIONS.md) |
| Logitech PRO X2 SUPERSTRIKE (mouse) | ✅ | — | ✅ click tuning, polling rate. See [PROTOCOL-LOGITECH.md](docs/PROTOCOL-LOGITECH.md) |
| Logitech PRO X SUPERLIGHT 2 (mouse) | ✅ | — | ✅ polling rate |

## Development

```bash
npm install
npm run dev        # http://localhost:5173/deer/
npm test           # Vitest: packet builders, parsers, guard, sync planner
npm run build      # type-check and build into dist/
```

Click **Try demo keyboard** to work on the UI without hardware (`src/device/mock.ts`).

### Architecture

```
src/device/        all USB/HID knowledge; no React
  razer/           Razer mouse protocol, guard, feature-report transport, mock
  logitech/        Logitech HID++ 2.0 protocol, guard, transport, mock
  madlions/        MADLIONS MAD68 HE protocol, guard, transport, mock
  transport.ts     KeyboardTransport interface + Channel (allow-list, dry-run, log, echo matching, backup hook)
  guard.ts         opcode allow-list and per-packet value checks
  packets.ts       packet builders and parsers
  profile.ts       profile model, diffing, sync planner, import/export
  models.ts        model table, encoding dialects, lighting tables
  layouts.ts       physical key geometry
  webhid.ts        WebHID transport
  mock.ts          simulated A75 Pro
src/state/         Zustand store (IndexedDB-persisted) and device session
src/ui/            React components
public/sniffer.user.js   read-only WebHID capture tool
```

The UI only talks to `Channel`. To ship a desktop build with Tauri or Electron, write a `KeyboardTransport` that uses `node-hid` and pass it to the session. Nothing in the UI needs to change.

### Deploying

Each push to `main` runs the tests, builds, and publishes to GitHub Pages (`.github/workflows/deploy.yml`). The app is served from `/deer/`; for other hosts, set `BASE_PATH=/` when building.

## Credits

The protocol knowledge comes from these projects; thank you to their authors:

- [2xxn/cli-drunkdeer](https://github.com/2xxn/cli-drunkdeer) (Apache-2.0): report ID, opcodes, identity, actuation packets, LED modes, key presets.
- [svumo/DrunkDeer-Control](https://github.com/svumo/DrunkDeer-Control) (MIT): A75 Pro hardware captures, the mm × 100 scale, mode-switch byte map, Last Win / Dual-Trigger / custom RGB formats, and safety warnings.
- [openrazer/openrazer](https://github.com/openrazer/openrazer) (GPL-2.0, facts only, no code copied) and the Viper V4 Pro capture in [openrazer#2760](https://github.com/openrazer/openrazer/issues/2760): Razer report format and mouse commands.
- [NasirA1991/madlions-control](https://github.com/NasirA1991/madlions-control) (MIT): MADLIONS 32-byte vendor protocol, MAD68 HE layout and lighting table, hardware-verified on a MAD68 HE RGB.
- [pwr-Solaar/Solaar](https://github.com/pwr-Solaar/Solaar) (GPL-2.0, facts only, no code copied) and [kazehana99k's SUPERSTRIKE notes](https://github.com/kazehana99k/Logitech-PRO-X2-SUPERSTRIKE-Linux-haptics-actuation-control-): HID++ 2.0 framing and the SUPERSTRIKE tuning feature (0x1B0C).
- [xuckless/deerctl](https://github.com/xuckless/deerctl) (MIT): model table, default keymaps, remap target encoding, per-model precision cutoffs. `src/device/data/models.json` is derived from its `models.json`.

DeerTune's code is original and licensed under Apache-2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)). "DrunkDeer" is a trademark of its owner. The DeerTune name and logo are this project's own.
