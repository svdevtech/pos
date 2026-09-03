'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Alert,
  Box,
  Chip,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PrintIcon from '@mui/icons-material/Print';
import ClearIcon from '@mui/icons-material/Clear';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { useLocale, useTranslations } from 'next-intl';

export interface HelpDoc {
  /** stable id used by the tab query string */
  id: string;
  /** i18n key under `help.docs` */
  labelKey: string;
  markdown: string;
}

interface Section {
  slug: string;
  title: string;
  /** markdown of the whole section including its heading */
  body: string;
  /** h3 sub-headings for the table of contents */
  subs: { slug: string; title: string }[];
}

/** GitHub-compatible slug so the in-document links (#4-ขายหน้าร้าน-pos) resolve. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, '')  // keep Thai vowel/tone marks (\p{M}) so anchors match the document's own TOC links
    .trim()
    .replace(/\s+/g, '-');
}

/** Scrolls a heading just below the app bar. Instant: the manual is ~18,000 px tall and smooth scrolling stalls. */
function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - 88;
  window.scrollTo({ top: top < 0 ? 0 : top, behavior: 'auto' });
}

function headingText(children: unknown): string {
  const walk = (node: unknown): string => {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(walk).join('');
    const el = node as { props?: { children?: unknown } };
    if (el.props?.children !== undefined) return walk(el.props.children);
    return '';
  };
  return walk(children);
}

/** Splits the document into `## ` sections (the preamble keeps its own pseudo-section). */
function splitSections(markdown: string): { preamble: string; sections: Section[] } {
  const lines = markdown.split('\n');
  const sections: Section[] = [];
  const preamble: string[] = [];
  let current: { title: string; lines: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    const body = current.lines.join('\n');
    const subs: { slug: string; title: string }[] = [];
    let fence = false;
    for (const line of current.lines) {
      if (line.startsWith('```')) fence = !fence;
      if (!fence && line.startsWith('### ')) {
        const title = line.slice(4).trim();
        subs.push({ slug: slugify(title), title });
      }
    }
    sections.push({ slug: slugify(current.title), title: current.title, body, subs });
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && line.startsWith('## ')) {
      flush();
      current = { title: line.slice(3).trim(), lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  flush();
  return { preamble: preamble.join('\n'), sections };
}

const markdownComponents = {
  h1: (props: { children?: React.ReactNode }) => (
    <Typography variant="h4" sx={{ mt: 2, mb: 1.5, fontWeight: 700 }}>
      {props.children}
    </Typography>
  ),
  h2: (props: { children?: React.ReactNode }) => (
    <Typography
      id={slugify(headingText(props.children))}
      variant="h5"
      sx={{ mt: 4, mb: 1.5, fontWeight: 700, scrollMarginTop: 88, borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}
    >
      {props.children}
    </Typography>
  ),
  h3: (props: { children?: React.ReactNode }) => (
    <Typography id={slugify(headingText(props.children))} variant="h6" sx={{ mt: 3, mb: 1, fontWeight: 700, scrollMarginTop: 88 }}>
      {props.children}
    </Typography>
  ),
  h4: (props: { children?: React.ReactNode }) => (
    <Typography variant="subtitle1" sx={{ mt: 2, mb: 0.5, fontWeight: 700 }}>
      {props.children}
    </Typography>
  ),
  p: (props: { children?: React.ReactNode }) => (
    <Typography variant="body2" sx={{ my: 1.2, lineHeight: 1.9 }}>
      {props.children}
    </Typography>
  ),
  ul: (props: { children?: React.ReactNode }) => (
    <Box component="ul" sx={{ pl: 3, my: 1, '& li': { mb: 0.5, fontSize: 14, lineHeight: 1.9 } }}>
      {props.children}
    </Box>
  ),
  ol: (props: { children?: React.ReactNode }) => (
    <Box component="ol" sx={{ pl: 3, my: 1, '& li': { mb: 0.5, fontSize: 14, lineHeight: 1.9 } }}>
      {props.children}
    </Box>
  ),
  table: (props: { children?: React.ReactNode }) => (
    <Box sx={{ overflowX: 'auto', my: 2 }}>
      <Box
        component="table"
        sx={{
          borderCollapse: 'collapse',
          width: '100%',
          fontSize: 14,
          '& th, & td': { border: '1px solid', borderColor: 'divider', px: 1.2, py: 0.8, textAlign: 'left', verticalAlign: 'top' },
          '& th': { bgcolor: 'action.hover', fontWeight: 700, whiteSpace: 'nowrap' },
        }}
      >
        {props.children}
      </Box>
    </Box>
  ),
  code: (props: { children?: React.ReactNode; className?: string }) => {
    const block = Boolean(props.className);
    return (
      <Box
        component="code"
        sx={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          px: block ? 0 : 0.7,
          py: block ? 0 : 0.2,
          borderRadius: 1,
          bgcolor: block ? 'transparent' : 'action.hover',
          whiteSpace: block ? 'pre' : 'normal',
        }}
      >
        {props.children}
      </Box>
    );
  },
  pre: (props: { children?: React.ReactNode }) => (
    <Box
      component="pre"
      sx={{
        my: 2,
        p: 1.5,
        borderRadius: 2,
        overflowX: 'auto',
        bgcolor: 'action.hover',
        border: '1px solid',
        borderColor: 'divider',
        fontSize: 13,
        lineHeight: 1.7,
      }}
    >
      {props.children}
    </Box>
  ),
  blockquote: (props: { children?: React.ReactNode }) => (
    <Box
      sx={{
        my: 2,
        px: 2,
        py: 0.5,
        borderLeft: '4px solid',
        borderColor: 'primary.main',
        bgcolor: 'action.hover',
        borderRadius: 1,
        '& p': { my: 1 },
      }}
    >
      {props.children}
    </Box>
  ),
  a: (props: { children?: React.ReactNode; href?: string }) => {
    const href = props.href ?? '';
    if (href.startsWith('#')) {
      // markdown percent-encodes Thai fragments; decode and scroll ourselves so the offset is right
      return (
        <Box
          component="a"
          href={href}
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            let id = href.slice(1);
            try {
              id = decodeURIComponent(id);
            } catch {
              /* keep raw id */
            }
            scrollToId(id);
          }}
          sx={{ color: 'primary.main', textDecoration: 'none', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
        >
          {props.children}
        </Box>
      );
    }
    // links to sibling markdown files are not routable inside the app
    if (href.endsWith('.md') || href.includes('.md#')) return <>{props.children}</>;
    return (
      <Box
        component="a"
        href={href}
        target="_blank"
        rel="noreferrer"
        sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
      >
        {props.children}
      </Box>
    );
  },
  hr: () => <Divider sx={{ my: 3 }} />,
};

export default function HelpView({ docs }: { docs: HelpDoc[] }) {
  const t = useTranslations('help');
  const locale = useLocale();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('lg'));
  const [docIndex, setDocIndex] = useState(0);
  const [query, setQuery] = useState('');

  const doc = docs[docIndex] ?? docs[0];
  const parsed = useMemo(() => splitSections(doc?.markdown ?? ''), [doc?.markdown]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? parsed.sections.filter((s) => s.body.toLowerCase().includes(q)) : parsed.sections),
    [parsed.sections, q],
  );

  const goTo = (slug: string) => scrollToId(slug);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <MenuBookIcon /> {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            sx={{ minWidth: { xs: '100%', sm: 260 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setQuery('')} aria-label={t('clearSearch')}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
          <IconButton onClick={() => window.print()} aria-label={t('print')} title={t('print')}>
            <PrintIcon />
          </IconButton>
        </Stack>
      </Stack>

      {docs.length > 1 && (
        <Tabs
          value={docIndex}
          onChange={(_, v: number) => {
            setDocIndex(v);
            setQuery('');
          }}
          variant="scrollable"
          scrollButtons="auto"
          className="no-print"
        >
          {docs.map((d) => (
            <Tab key={d.id} label={t(`docs.${d.labelKey}`)} />
          ))}
        </Tabs>
      )}

      {locale !== 'th' && (
        <Alert severity="info" className="no-print">
          {t('thaiOnly')}
        </Alert>
      )}

      {q && (
        <Alert severity={visible.length ? 'success' : 'warning'} className="no-print">
          {visible.length ? t('matches', { count: visible.length }) : t('noResults')}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="flex-start">
        {wide && (
          <Paper
            className="no-print"
            sx={{ width: 300, flexShrink: 0, position: 'sticky', top: 88, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', p: 1 }}
          >
            <Typography variant="subtitle2" sx={{ px: 1, py: 0.5, fontWeight: 700 }}>
              {t('contents')}
            </Typography>
            <List dense disablePadding>
              {visible.map((s) => (
                <Box key={s.slug}>
                  <ListItemButton onClick={() => goTo(s.slug)} sx={{ borderRadius: 1 }}>
                    <ListItemText primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} primary={s.title} />
                  </ListItemButton>
                  {s.subs.map((sub) => (
                    <ListItemButton key={sub.slug} onClick={() => goTo(sub.slug)} sx={{ pl: 3, borderRadius: 1, py: 0.25 }}>
                      <ListItemText primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }} primary={sub.title} />
                    </ListItemButton>
                  ))}
                </Box>
              ))}
            </List>
          </Paper>
        )}

        <Paper sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 } }} id="help-content">
          {!q && parsed.preamble.trim() && (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {parsed.preamble}
            </ReactMarkdown>
          )}
          {visible.map((s) => (
            <Box key={s.slug}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {s.body}
              </ReactMarkdown>
            </Box>
          ))}
          <Divider sx={{ my: 3 }} />
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" className="no-print">
            <Chip size="small" label={t('backToTop')} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
            <Chip size="small" variant="outlined" component={Link} href="/dashboard" clickable label={t('backToDashboard')} />
          </Stack>
        </Paper>
      </Stack>
    </Stack>
  );
}
