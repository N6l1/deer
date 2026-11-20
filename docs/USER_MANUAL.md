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

- **Selecting keys:** click a key to select it and click it again to deselect it; selected keys stay selected until you do. Shift-click selects a range, dragging box-selects several, and **Clear** deselects everything. The quick buttons select WASD, all keys, letters or the number row.
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

## MAD 68 HE (MADLIONS)

1. Close the official configurator tab (hub.fgg.com.cn); only one app can use the keyboard at a time. Open the **MAD 68 HE** tab and click **Connect MAD 68 HE**.
2. DeerTune reads every key's actuation point and rapid-trigger setting, plus the lighting, straight from the keyboard.
3. Select keys (click, Ctrl/Shift-click, drag, or **WASD** / **All keys**), then set the action point (0.05–3.40 mm) and rapid trigger with its press and release sensitivity.
4. Turn on **Live travel** to watch each key's depth as you press it. This only reads from the keyboard and never writes.
5. **Keyboard layout:** pick **Windows** or **Mac**. Mac mode swaps the modifiers for macOS, so Win becomes ⌘ Command and Alt becomes ⌥ Option. The other keyboard switches (Win lock, NKRO and so on) are left as they are.
6. **SOCD:** click two keys (for example A, then D), choose how conflicts resolve (last input wins, first key wins, second key wins, or neutral), and click **Add pair from selection**. You can change a pair's mode or remove it with ×. Up to 16 slots are available; slots the official hub uses for rapid snappy or OKS are left alone.
7. Click **Save to Keyboard**, check the preview, and press **Send**. The changed tables are written in full and saved to the keyboard's flash, then read back to confirm.

Writes are allowed only when the keyboard reports firmware protocol 9. The MAD68 HE RGB is verified. On other variants (Lightless, Ultra, Limited) DeerTune reads everything but needs *Allow experimental writes* turned on before it writes. Key remapping, macros and per-key RGB still need the official hub.

## Mouse

Supported: **Razer Viper V4 Pro** and **Logitech PRO X2 SUPERSTRIKE**. One **Connect mouse** button handles both.

### Razer Viper V4 Pro

1. Close Razer Synapse, then open the **Mouse** tab and click **Connect mouse**. Choose the Viper V4 Pro, either the cable (wired) or the HyperSpeed dongle (wireless).
2. The browser may list the mouse several times, once per USB interface. If connecting fails, click Connect again and pick a different entry.
3. DeerTune reads the battery level, firmware, DPI stages, polling rate, sleep timer and low-battery threshold from the mouse.
4. Edit any of them, then click **Apply to mouse**. You'll see every report before it's sent, and dry-run works the same as for the keyboard. After a real write, DeerTune reads the settings back and tells you whether they match.

If a wireless mouse is asleep it won't answer. Move it and press **Refresh**. Button remapping isn't available yet.

### Logitech PRO X2 SUPERSTRIKE

1. **Quit Logitech G HUB** completely (including from the system tray). While it runs, it holds the mouse and every request fails with "busy".
2. Click **Connect mouse** and pick the LIGHTSPEED receiver (or the mouse itself if it's plugged in with the cable).
3. **SUPERSTRIKE click tuning** for each main button:
   - **Actuation point** 1–10: 1 is the shallowest, fastest click; 10 is the deepest.
   - **Rapid trigger** 1–5.
   - **Click haptics** 0–5, where 0 turns the haptic click off.
4. Click **Apply to mouse**. DeerTune reads the values back afterwards.

DPI, report rate and the onboard-profile state are shown but can't be changed yet. The mouse runs from its onboard profile, and changing those values would mean switching it to software mode.

## Profiles

Use **＋** for a new profile, **⤒** to import, and **⤓** to export all. Each profile's **⋯** menu has rename, duplicate, export and delete. Import accepts DeerTune exports and profile files exported from the official driver (actuation and RT values are matched by key name). Profiles are stored in your browser's IndexedDB.

## Firmware

DeerTune never flashes firmware. **Firmware Download** opens DrunkDeer's official page.

## Troubleshooting

- **The keyboard isn't in the picker:** close the official driver tab, replug the keyboard, and on Linux check the udev rule.
- **"Blocked opcode" in the log:** the safety guard stopped a packet. That's intended. Please report how it happened.
- **Something feels wrong after a write:** load your backup or a known-good profile, or reset from the official driver.
