'use client';

/**
 * Hosts the 3D floor plan, which is a separate Vite micro-app served from /fnb3d/ and embedded
 * in an iframe.
 *
 * Not for bundle size: @react-three/fiber augments JSX.IntrinsicElements globally, and inside
 * the Next TypeScript program that made every MUI polymorphic component fail with TS2590. A
 * separate program is the clean cure, and the iframe is the seam. State crosses it as messages
 * — the room, a status per table and the selection go in; taps and the frame rate come out.
 */

import { useEffect, useRef } from 'react';
import type { FloorPlanProps } from '@/components/fnb/floorStatus';

const SRC = '/fnb3d/index.html';

export default function FloorPlan3DFrame({ floor, statusOf, selectedId, onSelect, onFps }: FloorPlanProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  // the latest callbacks, so the single message listener never goes stale
  const cb = useRef({ onSelect, onFps });
  cb.current = { onSelect, onFps };

  const send = () => {
    const w = frame.current?.contentWindow;
    if (!w || !ready.current) return;
    const statuses = Object.fromEntries(floor.tables.map((t) => [t.id, statusOf(t.id)]));
    w.postMessage({ type: 'state', floor, statuses, selectedId }, '*');
  };
  // the scene asks for its first state whenever it finishes loading, which is usually after the
  // room has arrived from the API; the listener below is registered once, so it must reach for
  // this render's send, not the empty one it closed over on the first render
  const latest = useRef(send);
  latest.current = send;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const m = e.data as { type?: string; id?: string; fps?: number };
      if (m?.type === 'ready') {
        ready.current = true;
        latest.current();
      } else if (m?.type === 'select' && m.id) {
        cb.current.onSelect(m.id);
      } else if (m?.type === 'fps' && typeof m.fps === 'number') {
        cb.current.onFps?.(m.fps);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // every render of the host may carry a new status map or a moved table; push it across
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(send);

  return <iframe ref={frame} src={SRC} title="floor-plan-3d" data-testid="floor-3d" style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#0b1220' }} />;
}
