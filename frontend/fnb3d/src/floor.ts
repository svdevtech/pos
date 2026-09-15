/**
 * The room the scene draws, as the host sends it. This micro-app is its own TypeScript program
 * on purpose (see Scene.tsx) and cannot import from the Next app, so the few types and the zone
 * arithmetic are a copy of components/fnb/floorStatus.ts — keep the two in step.
 */

export type TableStatus = 'free' | 'seated' | 'waiting' | 'ready' | 'bill';

export const STATUS_COLOR: Record<TableStatus, string> = {
  free: '#3ba55d',
  seated: '#1E88E5',
  waiting: '#FB8C00',
  ready: '#E53935',
  bill: '#7C4DFF',
};

export interface Zone {
  id: string;
  name: string;
  color: string;
}

export interface Table {
  id: string;
  zoneId: string;
  name: string;
  seats: number;
  x: number;
  y: number;
  shape: 'round' | 'square' | 'long';
  rotation?: number;
}

export interface FloorData {
  zones: Zone[];
  tables: Table[];
  width: number;
  depth: number;
}

export const EMPTY_FLOOR: FloorData = { zones: [], tables: [], width: 8, depth: 6 };

export interface ZoneBox {
  zone: Zone;
  x: number;
  y: number;
  w: number;
  d: number;
}

const PAD = 0.9;

/** One box per zone that has tables, a metre round them. */
export function zoneBoxes(floor: FloorData): ZoneBox[] {
  const out: ZoneBox[] = [];
  for (const zone of floor.zones) {
    const ts = floor.tables.filter((t) => t.zoneId === zone.id);
    if (ts.length === 0) continue;
    const x0 = Math.max(0.1, Math.min(...ts.map((t) => t.x)) - PAD);
    const y0 = Math.max(0.1, Math.min(...ts.map((t) => t.y)) - PAD);
    const x1 = Math.min(floor.width - 0.1, Math.max(...ts.map((t) => t.x)) + PAD);
    const y1 = Math.min(floor.depth - 0.1, Math.max(...ts.map((t) => t.y)) + PAD);
    out.push({ zone, x: x0, y: y0, w: x1 - x0, d: y1 - y0 });
  }
  return out;
}
