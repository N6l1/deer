# Capturing the official driver's traffic

DeerTune keeps four features behind **Settings → Allow experimental writes**: Last Win, Release Dual-Trigger, remap, and the knob. Lighting direction also needs confirming. The reference projects disagree on the bytes for all of these. A short capture from your own A75 Pro running the official driver will settle them.

The sniffer is **read-only**. It wraps `sendReport`, `sendFeatureReport` and `receiveFeatureReport`, listens to `inputreport`, and records every report as hex under a label you type. It never sends anything to the keyboard itself.

## 1. Install the sniffer (choose one)

**A. Userscript (recommended).** Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey. Then open [`sniffer.user.js`](https://n6l1.github.io/deer/sniffer.user.js) (it's also in this repo under `public/`) and click *Install*. It loads automatically on `drunkdeer-antler.com`.

**B. DevTools console.** Open the official driver, press `F12`, go to *Console*, paste the whole contents of `public/sniffer.user.js`, and press Enter. Do this **before** you click Connect.

**C. Bookmarklet.** Create a bookmark whose URL is the contents of `public/sniffer.bookmarklet.txt`. Click it on the driver page before connecting.

When it's running, a small orange-bordered panel appears in the bottom-left corner with a *Current step label* box.

## 2. Before you start

- Take a screenshot or note of your current settings in the official driver, so you can restore them afterwards.
- Close DeerTune and any other tab that might be connected to the keyboard.

## 3. Capture script

For each step: type the **label** into the panel and press *Set* (or Enter), then do the action. Wait about 2 seconds after each Save before setting the next label.

| # | Label to type | Action in the official driver |
|---|---|---|
| 1 | `connect` | Click Connect and pick the keyboard. Wait 5 s. |
| 2 | `ap-w-020` | Performance: select **W**, set Action Point to **0.20**, Save. |
| 3 | `ap-w-200` | Set W back to **2.00**, Save. |
| 4 | `ap-max` | Drag the Action Point slider to its **maximum**, Save. Note the number shown. Then set it back to 2.00 and Save. |
| 5 | `rt-on` | Turn **Rapid Trigger** on, set W press 0.15 / release 0.30, Save. |
| 6 | `rt-off` | Turn Rapid Trigger off, Save. |
| 7 | `turbo-on` / `turbo-off` | Toggle **Turbo** on, Save; set the label to `turbo-off`, toggle it off, Save. |
| 8 | `track-on` | Turn **Keystroke tracking** on. Press **W** slowly all the way down and up twice. |
| 9 | `track-off` | Turn keystroke tracking off. |
| 10 | `lw-on-ad` | Turn **Last Win** on, make the pair **A / D**, Save. |
| 11 | `lw-add-ws` | Add the pair **W / S**, Save. |
| 12 | `lw-off` | Turn Last Win off, Save. |
| 13 | `rdt-on` | Turn **Release Dual-Trigger** on, configure one pair (any keys), Save. Note what you picked. |
| 14 | `rdt-off` | Turn it off, Save. |
| 15 | `remap-caps-lctrl` | Remap tab: **Caps Lock → Left Ctrl** on the base layer, Save. |
| 16 | `remap-fn-q-mute` | On the **Fn** layer, set **Q → Mute**, Save. |
| 17 | `remap-reset` | Reset all remaps, Save. |
| 18 | `knob-cw` / `knob-ccw` / `knob-press` | If the driver lets you remap the knob: set each action to something obvious (for example F13, F14, F15), with a separate label for each, Save. Then reset. |
| 19 | `led-breath-red` | Colour tab: **Breath**, colour **Red**, brightness **9**, speed **5**, Save. |
| 20 | `led-dir-N` | If there's a **Direction** control, step through each value with labels `led-dir-0`, `led-dir-1`, … |
| 21 | `led-custom` | **Custom** per-key lighting: paint **W** red and **Esc** blue, Save. |
| 22 | `profile-switch` | If the driver has onboard profiles: switch to profile 2 and back. |
| 23 | `restore` | Put your own settings back and Save. |

## 4. Export and send

Click **Export .txt** in the panel (or *Copy*) and paste the file into a GitHub issue or the chat. The log contains only HID report bytes, timestamps and your labels. Nothing personal is in it.

## What each step answers

| Steps | Open question in [PROTOCOL.md](PROTOCOL.md) |
|---|---|
| 2–4 | Confirms the mm × 100 scale and the real slider maximum on firmware 0.023 |
| 8–9 | `B6 03` vs `FD 03` to turn on tracking; where the stream's chunk index sits |
| 10–14 | The full Last Win / Dual-Trigger save sequence |
| 15–17 | Keymap packing, and whether `AA` / `A7` / `A8` follow a remap |
| 18 | Knob event IDs |
| 19–21 | Lighting byte order and direction byte |
