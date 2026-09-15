/**
 * Entry of the 3D floor-plan micro-app.
 *
 * The Next app embeds this page in an iframe and talks to it with postMessage:
 *   host → scene  { type: 'state', floor, statuses: Record<tableId, TableStatus>, selectedId }
 *   scene → host  { type: 'select', id }          a table was tapped
 *                 { type: 'fps', fps }            once a second, so the host can fall back to 2D
 *                 { type: 'ready' }               the scene is mounted and wants its first state
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Scene from './Scene';
import { EMPTY_FLOOR, type FloorData, type TableStatus } from './floor';

interface HostState {
  floor: FloorData;
  statuses: Record<string, TableStatus>;
  selectedId: string | null;
}

const post = (msg: unknown) => window.parent?.postMessage(msg, '*');

function App() {
  const [state, setState] = useState<HostState>({ floor: EMPTY_FLOOR, statuses: {}, selectedId: null });

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string } & Partial<HostState>;
      if (m?.type === 'state') setState({ floor: m.floor ?? EMPTY_FLOOR, statuses: m.statuses ?? {}, selectedId: m.selectedId ?? null });
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <Scene
      floor={state.floor}
      statusOf={(id) => state.statuses[id] ?? 'free'}
      selectedId={state.selectedId}
      onSelect={(id) => post({ type: 'select', id })}
      onFps={(fps) => post({ type: 'fps', fps })}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
