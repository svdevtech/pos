'use client';

import { useEffect, useRef } from 'react';

/**
 * Catches HID barcode scanners (USB guns, PDA trigger scanners in keyboard-wedge mode) no matter
 * where the focus currently is.
 *
 * The scan box normally keeps the focus, but a cashier who tapped a cart row, a chip or a button
 * would otherwise scan into nothing. A human cannot type 8+ characters at ~20 ms apart and finish
 * with Enter, so that timing pattern is what identifies a scanner. Typing into any field is left
 * alone — those inputs handle their own Enter.
 */
export interface WedgeOptions {
  enabled?: boolean;
  /** Shortest accepted code; guards against stray key repeats. */
  minLength?: number;
  /** Longest gap between two characters of one scan, in ms. */
  maxGapMs?: number;
}

export function useWedgeScanner(onCode: (code: string) => void, { enabled = true, minLength = 4, maxGapMs = 60 }: WedgeOptions = {}) {
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let last = 0;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = e.timeStamp || performance.now();
      if (e.key === 'Enter') {
        const code = buffer;
        buffer = '';
        if (code.length >= minLength) {
          e.preventDefault();
          cb.current(code);
        }
        return;
      }
      if (e.key.length !== 1) return; // Shift, arrows, F-keys …
      if (now - last > maxGapMs) buffer = '';
      last = now;
      buffer += e.key;
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, minLength, maxGapMs]);
}
