import { APPLE_QUIRK, PRODUCT_IDS, REPORT_ID, VENDOR_ID, VENDOR_USAGE_PAGE } from './constants';
import type { KeyboardTransport } from './transport';

export const isWebHidSupported = () => typeof navigator !== 'undefined' && 'hid' in navigator;

/** Filters for the browser device picker: DrunkDeer vendor interface only (usage page 0xFF00). */
export function hidFilters(): HIDDeviceFilter[] {
  return [
    ...PRODUCT_IDS.map((productId) => ({ vendorId: VENDOR_ID, productId, usagePage: VENDOR_USAGE_PAGE })),
    { vendorId: VENDOR_ID, usagePage: VENDOR_USAGE_PAGE },
    { ...APPLE_QUIRK, usagePage: VENDOR_USAGE_PAGE },
  ];
}

const hasVendorCollection = (d: HIDDevice) =>
  d.collections.some((c) => c.usagePage === VENDOR_USAGE_PAGE && (c.outputReports ?? []).some((r) => r.reportId === REPORT_ID));

export class WebHidTransport implements KeyboardTransport {
  readonly kind = 'webhid';
  constructor(private device: HIDDevice) {}

  get productName() {
    return this.device.productName;
  }
  get productId() {
    return this.device.productId;
  }

  /** Ask the user to pick a keyboard. Returns null if they cancel. */
  static async request(): Promise<WebHidTransport | null> {
    const picked = await navigator.hid.requestDevice({ filters: hidFilters() });
    const dev = picked.find(hasVendorCollection) ?? picked[0];
    return dev ? new WebHidTransport(dev) : null;
  }

  /** Previously-authorised devices, for silent reconnect. */
  static async known(): Promise<WebHidTransport[]> {
    const list = await navigator.hid.getDevices();
    return list.filter((d) => d.vendorId === VENDOR_ID || d.vendorId === APPLE_QUIRK.vendorId).filter(hasVendorCollection).map((d) => new WebHidTransport(d));
  }

  async open() {
    if (!this.device.opened) await this.device.open();
  }

  async close() {
    if (this.device.opened) await this.device.close();
  }

  async send(payload: Uint8Array) {
    await this.device.sendReport(REPORT_ID, payload as BufferSource);
  }

  onInput(listener: (data: Uint8Array) => void) {
    const h = (e: HIDInputReportEvent) => {
      if (e.reportId !== REPORT_ID) return;
      listener(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
    };
    this.device.addEventListener('inputreport', h);
    return () => this.device.removeEventListener('inputreport', h);
  }

  onDisconnect(listener: () => void) {
    const h = (e: HIDConnectionEvent) => e.device === this.device && listener();
    navigator.hid.addEventListener('disconnect', h);
    return () => navigator.hid.removeEventListener('disconnect', h);
  }
}
