/**
 * The floor the scene draws. A copy of the prototype data in lib/fnb/mock.ts: this micro-app is
 * its own TypeScript program on purpose (see Scene.tsx) and cannot reach into the Next app.
 * When the floor plan comes from the API both sides will read the same JSON instead.
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

export const FLOOR = { width: 12, depth: 8 };

export const zones: Zone[] = [
  { id: 'z-in', name: 'ในร้าน', color: '#2b3d55' },
  { id: 'z-out', name: 'ระเบียง', color: '#2f4a3e' },
  { id: 'z-bar', name: 'บาร์', color: '#4a3a2b' },
];

export const tables: Table[] = [
  { id: 't-1', zoneId: 'z-in', name: '1', seats: 2, x: 1.5, y: 2, shape: 'round' },
  { id: 't-2', zoneId: 'z-in', name: '2', seats: 2, x: 3.5, y: 2, shape: 'round' },
  { id: 't-3', zoneId: 'z-in', name: '3', seats: 4, x: 1.5, y: 4.2, shape: 'square' },
  { id: 't-4', zoneId: 'z-in', name: '4', seats: 4, x: 3.5, y: 4.2, shape: 'square' },
  { id: 't-5', zoneId: 'z-in', name: '5', seats: 6, x: 6, y: 3.2, shape: 'long' },
  { id: 't-6', zoneId: 'z-in', name: '6', seats: 4, x: 1.5, y: 6.4, shape: 'square' },
  { id: 't-7', zoneId: 'z-in', name: '7', seats: 4, x: 3.5, y: 6.4, shape: 'square' },
  { id: 't-8', zoneId: 'z-in', name: '8', seats: 6, x: 6, y: 6, shape: 'long' },
  { id: 't-11', zoneId: 'z-out', name: '11', seats: 2, x: 9.8, y: 2, shape: 'round' },
  { id: 't-12', zoneId: 'z-out', name: '12', seats: 2, x: 9.8, y: 4, shape: 'round' },
  { id: 't-13', zoneId: 'z-out', name: '13', seats: 4, x: 9.8, y: 6.2, shape: 'square' },
  { id: 't-b1', zoneId: 'z-bar', name: 'B1', seats: 1, x: 4.5, y: 0.5, shape: 'round' },
  { id: 't-b2', zoneId: 'z-bar', name: 'B2', seats: 1, x: 5.5, y: 0.5, shape: 'round' },
  { id: 't-b3', zoneId: 'z-bar', name: 'B3', seats: 1, x: 6.5, y: 0.5, shape: 'round' },
];
