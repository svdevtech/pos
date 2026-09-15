import type { TableStatus } from '@/lib/fnb/store';

/** Colour of a table on either floor plan, by what is happening at it. */
export const STATUS_COLOR: Record<TableStatus, string> = {
  free: '#3ba55d',
  seated: '#1E88E5',
  waiting: '#FB8C00',
  ready: '#E53935',
  bill: '#7C4DFF',
};

export interface FloorPlanProps {
  statusOf: (tableId: string) => TableStatus;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Reported once a second so the page can fall back to 2D when this device cannot keep up. */
  onFps?: (fps: number) => void;
}
