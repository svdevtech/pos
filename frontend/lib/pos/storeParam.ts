/**
 * The store a till belongs to, carried in the URL.
 *
 * A shop's shortcut opens `…/pos?store=BBR`, so the login screen already knows which store this
 * machine sells for and the cashier only types a name and a password. It is a default, not a lock:
 * an owner with more than one shop can clear the field and log into another store from the same
 * machine (each store has its own user accounts).
 *
 * The code is remembered per device, because the redirect to the login page drops the query string
 * and because the cashier may later open the site from a bookmark.
 */

export const STORE_CODE_KEY = 'pos.storeCode';

/** Accepts `?store=BBR` and the longer `?store_code=BBR`. */
export function storeFromSearch(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const raw = params.get('store') ?? params.get('store_code');
    const code = raw?.trim().toUpperCase();
    return code ? code : null;
  } catch {
    return null;
  }
}

/** The code this device was set up with, if any. */
export function readDeviceStore(): string {
  try {
    return window.localStorage.getItem(STORE_CODE_KEY) ?? '';
  } catch {
    return ''; // private mode
  }
}

/**
 * Only ever called with a code that came from the URL. A code someone typed by hand is deliberately
 * not remembered, so looking at another shop for a minute cannot quietly change what this till
 * defaults to.
 */
export function writeDeviceStore(code: string): void {
  try {
    if (code) window.localStorage.setItem(STORE_CODE_KEY, code);
    else window.localStorage.removeItem(STORE_CODE_KEY);
  } catch {
    /* private mode */
  }
}
