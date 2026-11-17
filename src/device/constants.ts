// Wire constants. Every value here is documented in docs/PROTOCOL.md with its source.

export const REPORT_ID = 0x04;
export const PAYLOAD_SIZE = 63; // bytes after the report ID
export const SLOT_COUNT = 126; // 6 rows x 21 columns firmware matrix

export const VENDOR_ID = 0x352d;
/** Product IDs requested by the official driver (per DrunkDeer-Control docs). */
export const PRODUCT_IDS = [
  0x2382, 0x2383, 0x2384, 0x2386, 0x2387, 0x238f, 0x2390, 0x2391, 0x2394, 0x23b3, 0x23b4, 0x23b5, 0x23b6,
];
/** A75 in macOS mode enumerates with Apple's vendor ID. */
export const APPLE_QUIRK = { vendorId: 0x05ac, productId: 0x024f };
export const VENDOR_USAGE_PAGE = 0xff00;

export const OP = {
  IDENTITY: 0xa0, // A0 02 00 = identity query, A0 02 04 = keymap layer write
  LED: 0xae,
  COMMON_SWITCH: 0xb5,
  TRAVEL: 0xb6, // B6 01/04/05 = actuation/downstroke/upstroke, B6 03 = keystroke tracking
  TRACKING_STREAM: 0xb7, // input only: live key depth
  PAIRS: 0xfc, // FC 0A clear, FC 01 Last Win pairs, FC 03 RDT pairs
  KNOB: 0xc1,
} as const;

export const TRAVEL_SUB = { actuation: 0x01, tracking: 0x03, downstroke: 0x04, upstroke: 0x05 } as const;
export type TravelKind = 'actuation' | 'downstroke' | 'upstroke';

/** Brightness and speed are hard-limited to 0..9; DrunkDeer-Control reports values >= 10 can brick an A75 Pro. */
export const LED_LEVEL_MAX = 9;
export const LED_CUSTOM_KEYS_PER_PACKET = 13;
