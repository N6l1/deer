# DeerTune user manual

DeerTune runs in your browser, connects to your DrunkDeer keyboard over WebHID, and keeps your profiles on your own computer. It is unofficial and not affiliated with DrunkDeer.

## Requirements

- A Chromium-based browser on desktop: Chrome, Edge, Brave or Opera. Firefox and Safari have no WebHID.
- On Linux, give your user access to the device first:
  `SUBSYSTEM=="hidraw", ATTRS{idVendor}=="352d", TAG+="uaccess", MODE="0660"` in `/etc/udev/rules.d/70-drunkdeer.rules`, then replug the keyboard.
- Close the official driver and any other app that's connected to the keyboard.

## Install as an app

Open the site, then click the install icon in the address bar (or *⋮ → Install DeerTune*). It then opens in its own window and works offline.

## Connecting

1. Click **Connect keyboard** and pick your keyboard from the browser's list.
2. DeerTune asks the keyboard who it is and shows the model and firmware, for example **A75 Pro · Firmware 0.023 · 0.01 mm**.
3. **Try demo keyboard** opens a simulated A75 Pro, so you can explore without hardware.

## Safety switches (Settings ⚙)

- **Dry-run mode** is on by default. Saving shows the exact bytes in the HID log without sending them. Turn it off when you're ready to write.
- **Allow experimental writes** is off by default. Last Win, Release Dual-Trigger, remap and knob packets are built from reverse-engineered sources that disagree with each other, so they're only sent with this switch on.
- **Automatic backup:** before the first real write in a session, DeerTune downloads a backup JSON file. The keyboard can't report per-key values, so the backup holds what the keyboard does report plus your profiles.

## Saving

Edits are kept in the current profile. The **Save to Keyboard** button shows how many changes are pending. Clicking it lists every packet first, and nothing is sent until you press **Send**. Only the features you changed are written. Switching profiles while connected queues a full write of the new profile.

## Performance

- **Selecting keys:** click a key; Ctrl/⌘-click to add or remove one; Shift-click to select a range; drag across empty space to box-select. The quick buttons select WASD, all keys, letters or the number row.
- **Set Action Point:** drag the vertical slider, type a value, or use the ↑/↓ arrow keys (↑ shallower, ↓ deeper, hold Shift for steps of 10). On A75 Pro firmware 0.017 and later the range is 0.20–2.00 mm in 0.01 mm steps. Older firmware uses 0.2–3.3 mm in 0.1 mm steps.
- Each keycap shows **actuation · downstroke · upstroke**. Values you changed since the last save are highlighted.
- **Rapid Trigger Mode** shows the press and release sensitivity sliders for the selected keys.
- **Turbo** and **Keystroke tracking** can't both be on. Turning on Last Win or Dual-Trigger switches Rapid Trigger on and Turbo off, the same as the official driver.
- **Keystroke tracking** takes effect immediately, not on Save. It streams live key depth: keycaps fill as you press them, and the graph follows the last selected key with its actuation and reset lines.
- **Last Win:** select two keys and click **Add pair**. The defaults are A/D and W/S.
- **Release Dual-Trigger:** select the press key, then the release key, and add the pair.
- **Reset all keys** puts every key back to 2.0 mm with no RT values. Nothing is written until you save.

## Colour

Pick an effect, then set brightness (0–9) and speed (0–9). Effects can only use the keyboard's 7 preset colours or rainbow. For any colour, turn on **Custom per-key RGB**, choose a brush colour (picker or hex), and paint by clicking or dragging over keys. **Fill all** colours every key; **Eyedropper** picks up a key's colour.

## Remap

Choose a layer (Base, Fn, Fn2), click a key, then pick what it should send: letters, numbers, symbols, F-keys, navigation, keypad, modifiers, media, mouse, keyboard functions, or Disable. Click the knob to assign its actions. **Reset key** and **Reset all remaps** undo changes.

## Profiles

Use **＋** for a new profile, **⤒** to import, and **⤓** to export all. Each profile's **⋯** menu has rename, duplicate, export and delete. Import accepts DeerTune exports and profile files exported from the official driver (actuation and RT values are matched by key name). Profiles are stored in your browser's IndexedDB.

## Firmware

DeerTune never flashes firmware. **Firmware Download** opens DrunkDeer's official page.

## Troubleshooting

- **The keyboard isn't in the picker:** close the official driver tab, replug the keyboard, and on Linux check the udev rule.
- **"Blocked opcode" in the log:** the safety guard stopped a packet. That's intended. Please report how it happened.
- **Something feels wrong after a write:** load your backup or a known-good profile, or reset from the official driver.
