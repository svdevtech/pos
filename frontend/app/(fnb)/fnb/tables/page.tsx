'use client';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard } from '@/components/glass';
import { fnbApi, fnbKeys } from '@/lib/fnb/api';
import { tables, zones } from '@/lib/fnb/mock';
import { tableUrl } from '@/lib/fnb/publicApi';
import { qrPath } from '@/lib/pos/qrPayload';
import { useFnb } from '@/lib/fnb/store';

/** A QR as inline SVG, from the same encoder the PromptPay code uses. */
function Qr({ text, size = 160 }: { text: string; size?: number }) {
  const m = useMemo(() => {
    try {
      return qrPath(text, 1);
    } catch {
      return null;
    }
  }, [text]);
  if (!m) return null;
  return (
    <svg viewBox={`0 0 ${m.size} ${m.size}`} width={size} height={size} style={{ display: 'block', background: '#fff', borderRadius: 8 }} shapeRendering="crispEdges">
      <path d={m.path} fill="#000" />
    </svg>
  );
}

/**
 * One card per table with the QR its customers scan. That code is replaced every time the table
 * is closed (and by hand with the rotate button), so it belongs on the tablet fixed to the
 * table rather than on a printed card: the tablet opens its own permanent link, shows the
 * current code big, and hears the next one over the stream.
 */
export default function TablesPage() {
  const t = useTranslations('fnb');
  const toast = useToast();
  const qc = useQueryClient();
  const { tableStatus } = useFnb();
  const codes = useMemo(() => tables.map((x) => x.name), []);
  const tokens = useQuery({ queryKey: fnbKeys.tables, queryFn: () => fnbApi.tables(codes), staleTime: 60_000 });
  const rotate = useMutation({
    mutationFn: (code: string) => fnbApi.rotateTable(code),
    onSuccess: () => void qc.invalidateQueries({ queryKey: fnbKeys.tables }),
    onError: (e) => toast.error(String((e as Error)?.message ?? e)),
  });
  const byCode = Object.fromEntries((tokens.data ?? []).map((x) => [x.table_code, x]));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(text);
    }
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('tablesQrHint')}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 1.5 }}>
        {tables.map((tb) => {
          const tk = byCode[tb.name];
          const url = tk ? tableUrl(tk.token) : '';
          const status = tableStatus(tb.id);
          return (
            <GlassCard key={tb.id} title={`${t('table')} ${tb.name}`} subtitle={`${zones.find((z) => z.id === tb.zoneId)?.name ?? ''} · ${t('seats', { n: tb.seats })}`} action={<Chip size="small" label={t(status === 'ready' ? 'readyTable' : status)} />} data-testid={`table-card-${tb.name}`}>
              <Stack alignItems="center" spacing={1}>
                {url ? <Qr text={url} /> : <Box sx={{ width: 160, height: 160 }} />}
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all', textAlign: 'center' }}>
                  {url}
                </Typography>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap justifyContent="center">
                  <GlassButton size="small" variant="outlined" startIcon={<OpenInNewIcon />} href={tk?.kiosk_token ? tableUrl(tk.kiosk_token) : '#'} target="_blank" disabled={!tk?.kiosk_token} title={t('kioskHint')}>
                    {t('openKiosk')}
                  </GlassButton>
                  <GlassButton size="small" variant="text" startIcon={<ContentCopyIcon />} onClick={() => void copy(url)} disabled={!url}>
                    {t('copyLink')}
                  </GlassButton>
                  <GlassButton size="small" variant="text" color="warning" startIcon={<RefreshIcon />} onClick={() => rotate.mutate(tb.name)} disabled={rotate.isPending} title={t('rotateHint')}>
                    {t('rotateToken')}
                  </GlassButton>
                </Stack>
              </Stack>
            </GlassCard>
          );
        })}
      </Box>
    </Box>
  );
}
