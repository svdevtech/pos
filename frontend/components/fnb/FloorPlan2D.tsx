'use client';

/**
 * The same dining room as FloorPlan3D, drawn as SVG. This is what a device with no WebGL — or one
 * that cannot hold a frame rate — gets, so the floor plan is never the reason a shop cannot see
 * its tables. Same props, same colours, same tap targets.
 */

import { useTheme } from '@mui/material/styles';
import { FLOOR, tables, zones } from '@/lib/fnb/mock';
import { STATUS_COLOR, type FloorPlanProps } from '@/components/fnb/floorStatus';

const S = 70; // px per metre

export default function FloorPlan2D({ statusOf, selectedId, onSelect }: Omit<FloorPlanProps, 'onFps'>) {
  const theme = useTheme();
  const w = FLOOR.width * S;
  const h = FLOOR.depth * S;
  const parts = [
    { z: zones[0], x: 0, y: 1.2, w: 8, d: FLOOR.depth - 1.2 },
    { z: zones[2], x: 0, y: 0, w: 8, d: 1.2 },
    { z: zones[1], x: 8, y: 0, w: FLOOR.width - 8, d: FLOOR.depth },
  ];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }} data-testid="floor-2d">
      <rect width={w} height={h} rx={12} fill={theme.palette.mode === 'dark' ? '#0b1220' : '#e8eef4'} />
      {parts.map((p) => (
        <g key={p.z.id}>
          <rect x={p.x * S + 2} y={p.y * S + 2} width={p.w * S - 4} height={p.d * S - 4} rx={8} fill={p.z.color} />
          <text x={p.x * S + 12} y={p.y * S + 20} fontSize={13} fill="rgba(255,255,255,0.55)" fontWeight={700}>
            {p.z.name}
          </text>
        </g>
      ))}
      {tables.map((tb) => {
        const status = statusOf(tb.id);
        const color = STATUS_COLOR[status];
        const selected = tb.id === selectedId;
        const cx = tb.x * S;
        const cy = tb.y * S;
        const size = tb.shape === 'long' ? { w: 1.8 * S, h: 0.9 * S } : tb.shape === 'square' ? { w: 0.9 * S, h: 0.9 * S } : { w: 0.8 * S, h: 0.8 * S };
        return (
          <g key={tb.id} onClick={() => onSelect(tb.id)} style={{ cursor: 'pointer' }} data-testid={`table-${tb.id}`} data-status={status}>
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
