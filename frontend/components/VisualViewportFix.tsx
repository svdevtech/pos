'use client';

import { useEffect } from 'react';

/**
 * Keeps dialogs usable while an on-screen keyboard is open (iPad / Android tablets).
 *
 * iOS Safari does not shrink the layout viewport when the software keyboard appears, so a dialog
 * centred on `100vh` ends up half-hidden behind the keyboard. We publish the *visual* viewport
 * height/offset as CSS variables (`--vvh`, `--vv-top`) and flag `kb-open` on <html>; globals.css
 * sizes `.MuiDialog-paper` from those variables. We also scroll the focused field into view, since
 * iOS only does that reliably for the layout viewport.
 */
export default function VisualViewportFix() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const apply = () => {
      const h = vv?.height ?? window.innerHeight;
      const top = vv?.offsetTop ?? 0;
      root.style.setProperty('--vvh', `${Math.round(h)}px`);
      root.style.setProperty('--vv-top', `${Math.round(top)}px`);
      // a keyboard typically eats >120px; below that treat it as a normal resize
      root.classList.toggle('kb-open', window.innerHeight - h > 120);
    };

    apply();
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    window.addEventListener('resize', apply);

    // bring the focused field above the keyboard (iOS skips this inside fixed-position dialogs)
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.matches('input, textarea, select, [contenteditable="true"]')) return;
      window.setTimeout(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 250);
    };
    document.addEventListener('focusin', onFocusIn);

    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
      window.removeEventListener('resize', apply);
      document.removeEventListener('focusin', onFocusIn);
      root.classList.remove('kb-open');
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vv-top');
    };
  }, []);

  return null;
}
