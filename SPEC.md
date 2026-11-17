# Build "DeerTune": an open-source configurator for my DrunkDeer a75 pro keyboard

## Goal
Build a desktop-friendly web app that replaces DrunkDeer's official web driver (DrunkDeer Antler, https://beta.drunkdeer-antler.com). It must talk to my keyboard directly over USB HID and include every feature the official driver has (listed below). Use your own name and logo for the app. Do NOT copy DrunkDeer's logo or branding.

## Tech stack
- Vite + React + TypeScript + Tailwind, using the **WebHID API** (`navigator.hid`). The official driver uses WebHID too, so this works in Chrome, Edge, Brave and Opera with no native drivers.
- Make it an installable PWA so it works offline and opens like a desktop app.
- Keep all HID code in a separate `src/device/` layer behind a `KeyboardTransport` interface. That way I can wrap the app in Tauri or Electron with `node-hid` later without touching the UI.
- State: Zustand. Persistence: IndexedDB for profiles.

## PHASE 0: Protocol discovery (do this FIRST, before any UI)
The protocol is not officially documented. Start from these sources:
1. **Reference implementation:** https://github.com/2xxn/cli-drunkdeer (Go, Apache-2.0). Clone it and study `driver/`. Known details from it:
   - Report ID `0x04`, 59 keys per row packet, default actuation byte `0x14` (= 2.0mm)
   - Command bytes: `0xA0` identity, `0xAE` LED mode select, `0xB6` modify key (actuation / downstroke / upstroke per row), `0xB5` rapid trigger + turbo, `0xB7` keystroke tracking
   - LED sequences `0x00` to `0x13` (Off, Always, Spectrum, Breath, Press, Stars, Wave, Surf, SurfDown, Ripple, Fish, Fountain, Traffic, Snake, Surf Repeat, Surf Cross, Laser Key, Fountain Random, Custom)
   - Presets: WASD = indexes 44, 64, 65, 66; Numerals = 22–31; Character = 43–52, 64–72, 86–92
   - Models: A75, A75 Pro, G65, G60, G75. The identity response tells you which one is connected.
   Port the needed logic to TypeScript and credit the project in the README.
2. **Capture the official driver's traffic** for whatever the CLI doesn't cover (Release Dual-Trigger, Last Win, remapping, per-key RGB, profiles, the knob). Write me a small **"WebHID sniffer" bookmarklet/userscript**. It should monkey-patch `HIDDevice.prototype.sendReport`, `sendFeatureReport` and `receiveFeatureReport`, and listen to `inputreport`, logging every report as hex with a label I type in. Then give me a step-by-step script: "toggle Last Win on, then off, then export the log". I'll run it on the official site and paste the logs back to you so you can decode them.
3. Write everything you learn to `docs/PROTOCOL.md` (byte layouts, value encodings, key index map for my model).

## Safety rules (critical)
- People have reported that a third-party DrunkDeer driver once hit a destructive command code. **Never send a command byte that isn't documented in PROTOCOL.md.** Use an allow-list of opcodes in the transport layer and reject anything else.
- Make the first build **read-only**: connect, read identity, read current settings, and show raw hex.
- Add a **Dry-run mode** (on by default until I turn it off) that shows the exact bytes it would send without sending them.
- Before the first write, automatically back up the keyboard's current config to a JSON file.
- **Do not implement firmware flashing.** "Firmware Download" should just link to DrunkDeer's official page.

## Features to replicate (from the official UI)

### Global layout
- Dark theme with an orange/red accent gradient, plus a Light Mode toggle
- Top nav tabs: **Colour**, **Performance**, **Remap**
- Top right: User Manual (link), Firmware Download (link to official site), Language switcher (i18n with English + Arabic at minimum, RTL-ready), Light/Dark Mode
- Connection status plus a "Connect keyboard" button (WebHID picker filtered to DrunkDeer's vendor ID). Show the detected model and firmware version.
- **Save to Keyboard** button (bottom right). It's disabled until something changes and shows a pending-changes count.

### Profiles (left sidebar)
- List of profiles. Add (+), import/export as JSON (download icon), and per-profile settings menu: rename, duplicate, delete
- Switching profiles loads that profile's settings. Also mirror onboard keyboard profiles if the protocol supports them.

### Performance tab
- **Interactive keyboard map** matching my model's physical layout exactly, including the knob. Each keycap shows three numbers: `actuation  downstroke  upstroke` (e.g. `2.0 0.0 0.0`). Show changed values in a highlight colour.
- Key selection: click, Ctrl/Shift+click, drag-to-select box. Quick-select buttons: **WASD, All keys, Character, Numerals, Clear**.
- **Set Action Point** panel (right): vertical slider with a switch illustration, range and step per model (verify; likely 0.2–3.8mm in 0.1mm steps), number input, and ↑/↓ arrow-key fine-tuning
- **Rapid Trigger Mode** toggle. When it's on, show per-key downstroke and upstroke sensitivity sliders.
- **Release Dual-Trigger** toggle and config (separate actions for press vs release at a set travel)
- **Last Win** toggle (SOCD: the last pressed key wins). Allow choosing key pairs (default A/D, W/S).
- **Turbo mode** and **Keystroke tracking** toggles, each with a ? tooltip
- **Keystroke tracking live view**: when it's enabled, animate each key's real-time travel depth on the map from input reports, plus a single-key travel graph with actuation/reset lines drawn on it
- **Reset all keys** button (with a confirm dialog)

### Colour tab
- Effect picker for all LED sequences, with brightness, speed, direction and base colour (colour wheel plus hex input)
- **Custom per-key RGB**: paint keys on the keyboard map with a brush colour, fill all, eyedropper
- Live preview on the on-screen keyboard

### Remap tab
- Click a key, then choose a new function from a categorized picker: letters, modifiers, F-keys, media, mouse buttons, disable
- Fn layer support
- Knob remapping if the protocol allows it
- Reset key / reset all

## Code quality
- Strict TypeScript, unit tests (Vitest) for every packet builder and parser, using known-good byte fixtures from the CLI repo and my captures
- A `MockKeyboard` transport so the entire UI can be developed and tested without the hardware
- README with setup, supported models, protocol credits and a clear "unofficial, use at your own risk" notice

## Workflow
1. Do Phase 0 and give me the sniffer plus capture instructions. Stop and wait for my logs.
2. Build the read-only connection + Performance view against MockKeyboard, then real hardware.
3. Add writes behind dry-run, one feature at a time: actuation → RT → Turbo → Last Win → Dual-Trigger → lighting → remap. After each one, tell me exactly what to test on my keyboard.
Ask me questions whenever a protocol detail is uncertain. Don't guess byte values.