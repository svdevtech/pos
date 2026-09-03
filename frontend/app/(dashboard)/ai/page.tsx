'use client';

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import HistoryIcon from '@mui/icons-material/History';
import SendIcon from '@mui/icons-material/Send';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { api } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { MUTATING_ROLES } from '@/lib/auth/session';

interface AiStatus {
  enabled: boolean;
  gateway?: string;
  error?: string;
  base_url?: string;
  model?: string;
}

interface AiAnswer {
  question: string;
  sql: string;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  duration_ms: number;
  explanation?: string;
  warnings?: string[];
  truncated: boolean;
}

interface AiHistoryRow {
  id: number;
  question: string;
  row_count?: number;
  duration_ms?: number;
  error?: string;
  created_at: string;
}

function AiContent() {
  const t = useTranslations('ai');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AiAnswer | null>(null);

  const status = useQuery({ queryKey: ['ai', 'status'], queryFn: () => api.get<AiStatus>('/ai/status'), staleTime: 60_000 });
  const history = useQuery({
    queryKey: ['ai', 'history'],
    queryFn: () => api.get<AiHistoryRow[]>('/ai/history?limit=10'),
    enabled: status.data?.enabled === true,
  });

  const ask = useMutation({
    mutationFn: (q: string) => api.post<AiAnswer>('/ai/query', { question: q, explain: true }),
    onSuccess: (res) => {
      setAnswer(res);
      void history.refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const enabled = status.data?.enabled === true;
  const gatewayDown = enabled && status.data?.gateway !== 'ok';

  const submit = () => {
    const q = question.trim();
    if (!q || !enabled) return;
    ask.mutate(q);
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 1000 }}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {status.isPending && <Skeleton variant="rounded" height={120} />}

      {status.data && !enabled && (
        <Alert severity="info" data-testid="ai-disabled">
          <Stack spacing={0.5}>
            <Typography variant="body2" fontWeight={700}>
              {t('disabledTitle')}
            </Typography>
            <Typography variant="body2">{t('disabledBody')}</Typography>
          </Stack>
        </Alert>
      )}

      {gatewayDown && (
        <Alert severity="warning" data-testid="ai-gateway-down">
          {t('gatewayDown', { url: status.data?.base_url ?? '-' })}
        </Alert>
      )}

      <GlassCard title={t('askTitle')} subtitle={t('askHint')}>
        <Stack spacing={2}>
          <GlassInput
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t('placeholder')}
            multiline
            minRows={2}
            disabled={!enabled}
            inputProps={{ 'data-testid': 'ai-question', 'aria-label': t('askTitle') }}
          />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {(t.raw('examples') as string[]).map((ex) => (
              <Chip key={ex} label={ex} size="small" onClick={() => setQuestion(ex)} disabled={!enabled} />
            ))}
          </Stack>
          <Box>
            <GlassButton
              startIcon={<SendIcon />}
              onClick={submit}
              disabled={!enabled || question.trim() === ''}
              loading={ask.isPending}
              data-testid="ai-ask"
            >
              {t('ask')}
            </GlassButton>
          </Box>
        </Stack>
      </GlassCard>

      {answer && (
        <GlassCard title={t('answerTitle')} data-testid="ai-answer">
          <Stack spacing={2}>
            {answer.explanation && <Typography variant="body1">{answer.explanation}</Typography>}
            {(answer.warnings ?? []).map((w) => (
              <Alert key={w} severity="warning">
                {w}
              </Alert>
            ))}
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {answer.columns.map((c) => (
                      <TableCell key={c}>{c}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {answer.rows.map((row, i) => (
                    <TableRow key={i}>
                      {row.map((cell, j) => (
                        <TableCell key={j}>{cell === null ? '—' : String(cell)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t('meta', { rows: answer.row_count, ms: answer.duration_ms })}
              {answer.truncated ? ` · ${t('truncated')}` : ''}
            </Typography>
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  {t('sqlUsed')}
                </Typography>
                <GlassButton
                  size="small"
                  variant="text"
                  startIcon={<ContentCopyIcon fontSize="small" />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(answer.sql).then(() => toast.success(t('sqlCopied')));
                  }}
                  data-testid="ai-copy-sql"
                >
                  {t('copySql')}
                </GlassButton>
              </Stack>
              {/* wrapped, not scrolled: a hidden tail of the query is worse than three lines */}
              <Box
                component="pre"
                sx={{ m: 0, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                data-testid="ai-sql"
              >
                {answer.sql}
              </Box>
            </Stack>
          </Stack>
        </GlassCard>
      )}

      {enabled && (history.data?.length ?? 0) > 0 && (
        <GlassCard title={t('historyTitle')}>
          <Stack spacing={1}>
            {(history.data ?? []).map((h) => (
              <Stack key={h.id} direction="row" spacing={1} alignItems="center">
                <HistoryIcon fontSize="small" color="disabled" />
                <Typography
                  variant="body2"
                  sx={{ cursor: 'pointer', flex: 1, minWidth: 0 }}
                  noWrap
                  onClick={() => setQuestion(h.question)}
                >
                  {h.question}
                </Typography>
                <Typography variant="caption" color={h.error ? 'error.main' : 'text.secondary'}>
                  {h.error ? t('failed') : t('rows', { count: h.row_count ?? 0 })}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </GlassCard>
      )}

      {!enabled && (
        <GlassCard>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <AutoAwesomeIcon color="disabled" />
            <Typography variant="body2" color="text.secondary">
              {t('whenEnabled')}
            </Typography>
          </Stack>
        </GlassCard>
      )}
    </Stack>
  );
}

export default function AiPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <AiContent />
    </RequireAuth>
  );
}
