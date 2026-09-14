/**
 * Opening a cash drawer that hangs off a serial port instead of the receipt printer.
 *
 * Most shops wire the drawer into the printer's DK socket and the driver pops it on every job
 * (see lib/print/drawerKick.ts). Some printers have no DK socket, so the drawer goes through a
 * USB-serial "drawer kicker" box instead — the box shows up as COM3/COM4 and fires the solenoid
 * when it is poked. That is what the legacy POS did with its `company_cashcomport` setting.
 *
 * Chrome can talk to that box directly through the Web Serial API, so no helper program has to be
 * installed on the till. Two things to know about it:
 *
 *   - the port has to be picked by the cashier once, from a Chrome dialog, in a click handler;
 *     afterwards navigator.serial.getPorts() hands it back without asking again, for as long as
 *     the Chrome profile survives (hence the dedicated --user-data-dir in INSTALL_ONSITE.md).
 *   - only Chromium browsers on desktop have it, over HTTPS. Everything here degrades to "not
 *     supported" rather than throwing, and the shop falls back to the printed slip.
 *
 * Kicker boxes are not standardised: some fire on any byte, some watch DTR, some watch RTS. The
 * shop does not know which it owns, so the default trigger tries all three.
 */

/** Minimal shape of the bits of Web Serial we use; the DOM lib does not ship these types. */
interface SerialSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
}
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}
export interface SerialPortLike {
  open(options: { baudRate: number; dataBits?: number; stopBits?: number; parity?: string; flowControl?: string }): Promise<void>;
  close(): Promise<void>;
  setSignals(signals: SerialSignals): Promise<void>;
  getInfo(): SerialPortInfo;
  readonly writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(options?: { filters?: SerialPortInfo[] }): Promise<SerialPortLike>;
}

/** How the kicker box is told to fire. `auto` tries all three, which is what an unknown box needs. */
export type SerialTrigger = 'auto' | 'escpos' | 'dtr' | 'rts';

export const SERIAL_TRIGGERS: SerialTrigger[] = ['auto', 'escpos', 'dtr', 'rts'];
export const SERIAL_BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;
export const DEFAULT_SERIAL_BAUD = 9600;

const STORAGE_KEY = 'pos.drawerPort';
/** ESC p 0 25 250 — pin 2, then pin 5, the two the drawer can be wired to. */
const KICK_PIN_2 = Uint8Array.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
const KICK_PIN_5 = Uint8Array.from([0x1b, 0x70, 0x01, 0x19, 0xfa]);

const serial = (): SerialLike | null => {
  if (typeof navigator === 'undefined') return null;
  const s = (navigator as Navigator & { serial?: SerialLike }).serial;
  return s ?? null;
};

/** True when this browser can open a serial port at all (Chromium desktop, secure context). */
export function serialDrawerSupported(): boolean {
  return serial() !== null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const readRemembered = (): SerialPortInfo | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SerialPortInfo;
    return typeof v?.usbVendorId === 'number' ? v : null;
  } catch {
    return null;
  }
};

const remember = (port: SerialPortLike): void => {
  try {
    const info = port.getInfo();
    // a port with no USB ids is a built-in COM port; there is nothing to match on later, but
    // getPorts() will still return it as the only granted one
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ usbVendorId: info.usbVendorId, usbProductId: info.usbProductId }));
  } catch {
    /* private mode — the cashier picks the port again next session */
  }
};

/** Drops the saved port id. Chrome keeps its own grant; this only forgets which one we chose. */
export function forgetDrawerPort(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The port the shop already granted, without prompting. Null when nothing was granted yet, so the
 * caller can show "connect the drawer" instead of failing a sale.
 */
export async function rememberedDrawerPort(): Promise<SerialPortLike | null> {
  const s = serial();
  if (!s) return null;
  let ports: SerialPortLike[];
  try {
    ports = await s.getPorts();
  } catch {
    return null;
  }
  if (ports.length === 0) return null;
  const want = readRemembered();
  if (want) {
    const hit = ports.find((p) => {
      const i = p.getInfo();
      return i.usbVendorId === want.usbVendorId && (want.usbProductId === undefined || i.usbProductId === want.usbProductId);
    });
    if (hit) return hit;
  }
  // one granted port and no saved match: it can only be the drawer
  return ports.length === 1 ? ports[0] : null;
}

/**
 * Shows Chrome's port chooser and remembers what the cashier picks.
 * Must be called from a click — Chrome rejects it otherwise.
 */
export async function chooseDrawerPort(): Promise<SerialPortLike> {
  const s = serial();
  if (!s) throw new Error('serial-unsupported');
  const port = await s.requestPort();
  remember(port);
  return port;
}

async function write(port: SerialPortLike, bytes: Uint8Array): Promise<void> {
  const stream = port.writable;
  if (!stream) throw new Error('serial-not-writable');
  const writer = stream.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

async function fire(port: SerialPortLike, trigger: SerialTrigger): Promise<void> {
  if (trigger === 'escpos' || trigger === 'auto') {
    await write(port, KICK_PIN_2);
    await sleep(60);
    await write(port, KICK_PIN_5);
    if (trigger === 'escpos') return;
    await sleep(120);
  }
  if (trigger === 'dtr' || trigger === 'auto') {
    await port.setSignals({ dataTerminalReady: true });
    await sleep(200);
    await port.setSignals({ dataTerminalReady: false });
    if (trigger === 'dtr') return;
    await sleep(120);
  }
  if (trigger === 'rts' || trigger === 'auto') {
    await port.setSignals({ requestToSend: true });
    await sleep(200);
    await port.setSignals({ requestToSend: false });
  }
}

export interface PulseOptions {
  baudRate?: number;
  trigger?: SerialTrigger;
}

/**
 * Opens the drawer through the kicker box. The port is opened and closed around each pulse so the
 * legacy program — or a second till window — can still take it when this one is idle.
 *
 * Throws `serial-unsupported` when the browser has no Web Serial, and `serial-no-port` when the
 * shop has not picked a port yet; both are worth telling the cashier about rather than swallowing.
 */
export async function pulseDrawer(opts: PulseOptions = {}): Promise<void> {
  if (!serialDrawerSupported()) throw new Error('serial-unsupported');
  const port = await rememberedDrawerPort();
  if (!port) throw new Error('serial-no-port');
  await pulsePort(port, opts);
}

/** Same pulse against a port the caller already holds — used by the "test" button in settings. */
export async function pulsePort(port: SerialPortLike, opts: PulseOptions = {}): Promise<void> {
  await port.open({
    baudRate: opts.baudRate && opts.baudRate > 0 ? opts.baudRate : DEFAULT_SERIAL_BAUD,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
  });
  try {
    await fire(port, opts.trigger ?? 'auto');
  } finally {
    await port.close().catch(() => undefined);
  }
}
