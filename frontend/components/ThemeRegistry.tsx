'use client';

import createCache, { type EmotionCache } from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';
import { useServerInsertedHTML } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { createGlassTheme } from '@/lib/theme/glassTheme';

interface Props {
  children: ReactNode;
  mode?: PaletteMode;
}

/**
 * Emotion cache wired to the App Router streaming renderer. Styles inserted
 * during SSR are flushed with `useServerInsertedHTML` so there is no FOUC.
 */
export default function ThemeRegistry({ children, mode = 'dark' }: Props) {
  const [{ cache, flush }] = useState(() => {
    const cache: EmotionCache = createCache({ key: 'mui', prepend: true });
    cache.compat = true;
    const prevInsert = cache.insert;
    let inserted: string[] = [];
    cache.insert = (...args) => {
      const serialized = args[1];
      if (cache.inserted[serialized.name] === undefined) inserted.push(serialized.name);
      return prevInsert(...args);
    };
    const flush = () => {
      const prev = inserted;
      inserted = [];
      return prev;
    };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const names = flush();
    if (names.length === 0) return null;
    let styles = '';
    for (const name of names) {
      const css = cache.inserted[name];
      if (typeof css === 'string') styles += css;
    }
    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(' ')}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  const theme = useMemo(() => createGlassTheme(mode), [mode]);

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
