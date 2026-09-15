'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

/**
 * The floating screens beside the sign-in card: a kitchen ticket, the floor plan, a receipt,
 * today's takings and a table's QR — every one a sample, none a real shop. They sit in layered
 * depth (CSS 3D), fly in on load, drift, and tilt with the pointer; the ticket's clock runs,
 * dishes change state, tables change colour and the takings count up, so the page reads as a
 * live system rather than a poster.
 *
 * Purely decorative: aria-hidden, no headings (the page's only heading is the form's), and
 * hidden below the md breakpoint by the page.
 */

const STATUS = ['#3ba55d', '#FB8C00', '#E53935', '#7C4DFF', '#1E88E5'];
const TABLES = ['1', '2', '3', '4', '5', '6', '7', '8', 'B1'];

const card = {
  position: 'absolute' as const,
  borderRadius: '16px',
  transformStyle: 'preserve-3d' as const,
  boxShadow: '0 50px 90px -30px rgba(0,0,0,.95), inset 0 1px 0 rgba(255,255,255,.22)',
  background: 'rgba(16,22,44,.86)',
  border: '1px solid rgba(255,255,255,.14)',
  backdropFilter: 'blur(8px)',
  color: '#eef2ff',
  fontSize: 12,
  animation: 'lsHover 6s ease-in-out infinite, lsFly 1.2s cubic-bezier(.2,.8,.2,1) both',
  '&::after': { content: '""', position: 'absolute', inset: 0, borderRadius: 'inherit', background: 'linear-gradient(140deg, rgba(255,255,255,.16), transparent 40%)', pointerEvents: 'none' },
};

export default function LoginShowcase() {
  const t = useTranslations('auth.show');
  const wrap = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [tables, setTables] = useState<number[]>([0, 1, 0, 2, 3, 0, 1, 0, 4]);
  const [takings, setTakings] = useState(0);

  // pointer tilt with inertia; all three cards read the same two variables
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let tx = 0;
    let ty = 0;
    let px = 0;
    let py = 0;
    let raf = 0;
    const move = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
    };
    const loop = () => {
      px += (tx - px) * 0.06;
      py += (ty - py) * 0.06;
      el.style.transform = `rotateY(${-16 + px * 16}deg) rotateX(${7 - py * 12}deg)`;
      raf = requestAnimationFrame(loop);
    };
    if (!reduced) {
      window.addEventListener('pointermove', move);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(raf);
    };
  }, []);

  // the living data: a second hand, dishes moving along, tables changing, takings counting up
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = 18420;
    const start = performance.now();
    let raf = 0;
    const count = (now: number) => {
      const v = Math.min(1, (now - start) / 2200);
      setTakings(Math.round(target * (1 - Math.pow(1 - v, 3))));
      if (v < 1) raf = requestAnimationFrame(count);
    };
    raf = requestAnimationFrame(count);
    if (reduced) return () => cancelAnimationFrame(raf);
    const clock = window.setInterval(() => setTick((n) => n + 1), 1000);
    const floor = window.setInterval(() => setTables((cur) => cur.map((s, i) => (i === Math.floor(Math.random() * cur.length) ? Math.floor(Math.random() * STATUS.length) : s))), 2400);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(clock);
      window.clearInterval(floor);
    };
  }, []);

  const sec = 432 + tick;
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const step = Math.floor(tick / 2) % 3;
  const stateOf = (i: number) => (step + i) % 3; // 0 waiting · 1 preparing · 2 done
  const pill = (s: number) => (
    <Box component="i" sx={{ fontStyle: 'normal', fontSize: 10, px: 0.9, py: 0.2, borderRadius: 999, bgcolor: s === 2 ? '#3ba55d' : '#fb8c00', color: s === 2 ? '#fff' : '#000', fontWeight: 600 }}>
      {s === 0 ? t('waiting') : s === 1 ? t('preparing') : t('done')}
    </Box>
  );
  const line = (qty: string, name: string, i: number) => (
    <Box key={name} sx={{ px: 1.5, py: 1, display: 'flex', gap: 1, alignItems: 'center', borderBottom: '1px dashed rgba(255,255,255,.12)' }}>
      <Typography component="b" sx={{ fontWeight: 800, fontSize: 15, fontFamily: 'var(--font-kanit), var(--font-sarabun), sans-serif' }}>
        {qty}
      </Typography>
      <Box sx={{ flex: 1 }}>{name}</Box>
      {pill(stateOf(i))}
    </Box>
  );

  return (
    <Box
      ref={wrap}
      aria-hidden
      sx={{
        position: 'relative',
        height: 640,
        transformStyle: 'preserve-3d',
        transform: 'rotateY(-16deg) rotateX(7deg)',
        '@keyframes lsHover': { '0%,100%': { marginTop: 0 }, '50%': { marginTop: -14 } },
        '@keyframes lsFly': { from: { opacity: 0, transform: 'translateZ(-400px) translateY(60px)' } },
        '@media (prefers-reduced-motion: reduce)': { '& *': { animation: 'none !important' } },
      }}
    >
      {/* kitchen ticket */}
      <Box sx={{ ...card, left: '6%', top: '5%', width: 256, transform: 'translateZ(130px)', animationDelay: '-1s, .15s' }}>
        <Box sx={{ bgcolor: '#e53935', px: 1.5, py: 1, borderRadius: '16px 16px 0 0', fontWeight: 600, fontSize: 16, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-kanit), var(--font-sarabun), sans-serif' }}>
          <span>
            {t('table')} 5
          </span>
          <Box component="small" sx={{ fontSize: 12, opacity: 0.9, fontVariantNumeric: 'tabular-nums', fontWeight: 400 }}>
            {clock}
          </Box>
        </Box>
        {line('2×', t('item1'), 0)}
        {line('1×', t('item2'), 1)}
        {line('1×', t('item3'), 2)}
        <Box sx={{ m: 1.5, py: 1.1, textAlign: 'center', borderRadius: '10px', bgcolor: '#3ba55d', fontWeight: 600, fontSize: 13 }}>{t('doneAll')}</Box>
      </Box>

      {/* floor plan */}
      <Box sx={{ ...card, right: '3%', top: '1%', width: 214, p: 1.75, transform: 'translateZ(40px)', animationDelay: '-3s, .3s' }}>
        <Typography component="small" sx={{ display: 'block', fontSize: 11, letterSpacing: '.15em', color: '#9fb0d8', mb: 1 }}>
          {t('floorTonight')}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
          {TABLES.map((code, i) => (
            <Box key={code} sx={{ aspectRatio: '1', borderRadius: '10px', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 15, color: '#fff', bgcolor: STATUS[tables[i]], boxShadow: 'inset 0 -4px 0 rgba(0,0,0,.25)', transition: 'background .6s' }}>
              {code}
            </Box>
          ))}
        </Box>
      </Box>

      {/* receipt: a sample shop, a sample bill */}
      <Box sx={{ ...card, left: '38%', top: '38%', width: 214, p: '14px 14px 18px', transform: 'translateZ(210px)', background: '#fffdf8', color: '#2a2620', fontFamily: '"Courier New", monospace', fontSize: 11, lineHeight: 1.6, borderRadius: '8px', animationDelay: '-2s, .45s', '&::after': { display: 'none' } }}>
        <Box sx={{ fontWeight: 600, fontSize: 13, color: '#111', fontFamily: 'var(--font-kanit), var(--font-sarabun), sans-serif' }}>{t('sampleShop')}</Box>
        R0001-0042 · 10:42
        <Box sx={{ borderTop: '1px dashed #cfc7b8', my: 0.75 }} />
        {[
          [t('rc1'), '14.00'],
          [t('rc2'), '25.00'],
          [t('rc3'), '21.00'],
        ].map(([n, v]) => (
          <Box key={n} sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{n}</span>
            <span>{v}</span>
          </Box>
        ))}
        <Box sx={{ borderTop: '1px dashed #cfc7b8', my: 0.75 }} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
          <span>{t('total')}</span>
          <span>60.00</span>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('cash')}</span>
          <span>100.00</span>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('change')}</span>
          <span>40.00</span>
        </Box>
      </Box>

      {/* today's takings */}
      <Box sx={{ ...card, right: '8%', bottom: '8%', width: 244, p: '16px 18px', transform: 'translateZ(90px)', animationDelay: '-4s, .6s' }}>
        <Typography component="small" sx={{ fontSize: 11, letterSpacing: '.15em', textTransform: 'uppercase', color: '#9fb0d8' }}>
          {t('todaySales')}
        </Typography>
        <Typography component="b" sx={{ display: 'block', fontWeight: 800, fontSize: 30, letterSpacing: -0.5, my: '2px 0 6px', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-prompt), var(--font-kanit), var(--font-sarabun), sans-serif' }}>
          ฿ {takings.toLocaleString('th-TH')}
        </Typography>
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: '72%', background: 'linear-gradient(90deg,#22d3ee,#8b5cf6)' }} />
        </Box>
        <Box sx={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: 36, mt: 1.25 }}>
          {[30, 45, 38, 70, 95, 60, 52, 78].map((h, i) => (
            <Box key={i} sx={{ flex: 1, height: `${h}%`, bgcolor: '#3b82f6', borderRadius: '2px 2px 0 0', opacity: 0.85 }} />
          ))}
        </Box>
      </Box>

      {/* the table's QR */}
      <Box sx={{ ...card, left: '3%', bottom: '6%', width: 172, p: 1.75, textAlign: 'center', transform: 'translateZ(170px)', animationDelay: '-5s, .75s' }}>
        <Typography component="small" sx={{ fontSize: 12, fontWeight: 500, color: '#dfe6ff', fontFamily: 'var(--font-kanit), var(--font-sarabun), sans-serif' }}>
          {t('table')} 5 · {t('scanToOrder')}
        </Typography>
        <Box sx={{ width: 110, height: 110, mx: 'auto', my: '6px 8px', background: 'conic-gradient(#000 25%, transparent 0) 0 0/22px 22px, #fff', borderRadius: '8px', border: '6px solid #fff' }} />
        <Typography component="small" sx={{ fontSize: 11, color: '#9fb0d8' }}>
          {t('qrRotates')}
        </Typography>
      </Box>
    </Box>
  );
}
