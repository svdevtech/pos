import type { Table, TableStatus, Zone } from '@/lib/fnb/store';

/** Colour of a table on either floor plan, by what is happening at it. */
export const STATUS_COLOR: Record<TableStatus, string> = {
  free: '#3ba55d',
  seated: '#1E88E5',
  waiting: '#FB8C00',
  ready: '#E53935',
  bill: '#7C4DFF',
};

/** The room as both floor plans draw it: zones, tables placed in metres, and the floor's size. */
export interface FloorData {
  zones: Zone[];
  tables: Table[];
  width: number;
  depth: number;
}

export interface FloorPlanProps {
  floor: FloorData;
  statusOf: (tableId: string) => TableStatus;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Reported once a second so the page can fall back to 2D when this device cannot keep up. */
  onFps?: (fps: number) => void;
}

/** A metre round every table of the zone, so the zone's floor reads as one patch. */
export interface ZoneBox {
  zone: Zone;
  x: number;
  y: number;
  w: number;
  d: number;
}

const PAD = 0.9;

/** The floor's size from where the tables are: never smaller than a small café, always a little room past the last table. */
export function floorSize(tables: Pick<Table, 'x' | 'y'>[]): { width: number; depth: number } {
  let mx = 0;
  let my = 0;
  for (const t of tables) {
    mx = Math.max(mx, t.x);
    my = Math.max(my, t.y);
  }
  return { width: Math.max(8, Math.ceil((mx + 1.6) * 2) / 2), depth: Math.max(6, Math.ceil((my + 1.6) * 2) / 2) };
}

/** One box per zone that has tables, from their positions. Same arithmetic in fnb3d/src/floor.ts. */
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
