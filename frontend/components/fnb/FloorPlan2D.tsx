'use client';

/**
 * The same dining room as FloorPlan3D, drawn as SVG. This is what a device with no WebGL — or one
 * that cannot hold a frame rate — gets, so the floor plan is never the reason a shop cannot see
 * its tables. Same props, same colours, same tap targets. With `onPlace` it doubles as the floor
 * editor's canvas: a tap on the floor reports where, in metres.
 */

import { useTheme } from '@mui/material/styles';
import type { MouseEvent } from 'react';
import { STATUS_COLOR, zoneBoxes, type FloorPlanProps } from '@/components/fnb/floorStatus';

const S = 70; // px per metre

export default function FloorPlan2D({ floor, statusOf, selectedId, onSelect, onPlace }: Omit<FloorPlanProps, 'onFps'> & { onPlace?: (x: number, y: number) => void }) {
  const theme = useTheme();
  const w = floor.width * S;
  const h = floor.depth * S;
  const parts = zoneBoxes(floor);
  const place = (e: MouseEvent<SVGSVGElement>) => {
    if (!onPlace) return;
    const svg = e.currentTarget;
    const r = svg.getBoundingClientRect();
    // the viewBox is fitted with xMidYMid meet: same scale both ways, centred
    const scale = Math.min(r.width / w, r.height / h);
    const x = (e.clientX - r.left - (r.width - w * scale) / 2) / scale / S;
    const y = (e.clientY - r.top - (r.height - h * scale) / 2) / scale / S;
    if (x < 0 || y < 0 || x > floor.width || y > floor.depth) return;
    onPlace(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block', cursor: onPlace ? 'crosshair' : undefined }} data-testid="floor-2d" onClick={place}>
      <rect width={w} height={h} rx={12} fill={theme.palette.mode === 'dark' ? '#0b1220' : '#e8eef4'} />
      {parts.map((p) => (
        <g key={p.zone.id}>
          <rect x={p.x * S + 2} y={p.y * S + 2} width={p.w * S - 4} height={p.d * S - 4} rx={8} fill={p.zone.color} />
          <text x={p.x * S + 12} y={p.y * S + 20} fontSize={13} fill="rgba(255,255,255,0.55)" fontWeight={700}>
            {p.zone.name}
          </text>
        </g>
      ))}
      {floor.tables.map((tb) => {
        const status = statusOf(tb.id);
        const color = STATUS_COLOR[status];
        const selected = tb.id === selectedId;
        const cx = tb.x * S;
        const cy = tb.y * S;
        const size = tb.shape === 'long' ? { w: 1.8 * S, h: 0.9 * S } : tb.shape === 'square' ? { w: 0.9 * S, h: 0.9 * S } : { w: 0.8 * S, h: 0.8 * S };
        return (
          <g
            key={tb.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(tb.id);
            }}
            style={{ cursor: 'pointer' }}
            data-testid={`table-${tb.id}`}
            data-status={status}
            transform={tb.rotation ? `rotate(${tb.rotation} ${cx} ${cy})` : undefined}
          >
            {status === 'ready' && (
              <circle cx={cx} cy={cy} r={Math.max(size.w, size.h) * 0.7} fill={color} opacity={0.25}>
                <animate attributeName="r" values={`${size.w * 0.55};${size.w * 0.8};${size.w * 0.55}`} dur="1.4s" repeatCount="indefinite" />
              </circle>
            )}
            {tb.shape === 'round' ? (
              <circle cx={cx} cy={cy} r={size.w / 2} fill={color} stroke={selected ? '#fff' : 'rgba(0,0,0,0.35)'} strokeWidth={selected ? 4 : 2} />
            ) : (
              <rect x={cx - size.w / 2} y={cy - size.h / 2} width={size.w} height={size.h} rx={10} fill={color} stroke={selected ? '#fff' : 'rgba(0,0,0,0.35)'} strokeWidth={selected ? 4 : 2} />
            )}
            <text x={cx} y={cy + 6} textAnchor="middle" fontSize={20} fontWeight={800} fill="#fff">
              {tb.name}
            </text>
            <text x={cx} y={cy - size.h / 2 - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="rgba(255,255,255,0.8)">
              {tb.seats} 👤
            </text>
          </g>
        );
      })}
    </svg>
  );
}
