'use client';

import DeleteIcon from '@mui/icons-material/Delete';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import ProductAutocomplete from '@/components/ProductAutocomplete';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { useCreateStockTake } from '@/lib/api/hooks/inventory';
import type { Product } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';

function NewStockTakeContent() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const create = useCreateStockTake();

  const [note, setNote] = useState('');
  const [allProducts, setAllProducts] = useState(true);
  const [picked, setPicked] = useState<Product[]>([]);
  const [pick, setPick] = useState<Product | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const valid = allProducts || picked.length > 0;

  const submit = () => {
    setFormError(null);
    create.mutate(
      { note: note.trim(), product_ids: allProducts ? [] : picked.map((p) => p.id) },
      {
        onSuccess: (st) => {
          toast.success(t('stockTakeCreated', { docNo: st.doc_no }));
          router.replace(`/inventory/stock-takes/${st.id}`);
        },
        onError: (err) => setFormError(errorMessage(err)),
      },
    );
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 720 }}>
      <PageHeader title={t('newStockTake')} subtitle={t('newStockTakeHint')} backHref="/inventory/stock-takes" />
      {formError && <Alert severity="error">{formError}</Alert>}
      <GlassCard>
        <Stack spacing={2}>
          <GlassInput label={tc('notes')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} autoFocus />
          <FormControlLabel control={<Switch checked={allProducts} onChange={(e) => setAllProducts(e.target.checked)} />} label={t('allProducts')} />
          {!allProducts && (
            <Stack spacing={1.5}>
              <ProductAutocomplete
                value={pick}
                onChange={(p) => {
                  if (p) setPicked((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
                  setPick(null);
                }}
                clearOnSelect
                excludeIds={picked.map((p) => p.id)}
                label={t('pickProducts')}
              />
              {picked.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('noLines')}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {picked.map((p) => (
                    <ListItem
                      key={p.id}
                      disableGutters
                      secondaryAction={
                        <IconButton size="small" aria-label={tc('delete')} onClick={() => setPicked((prev) => prev.filter((x) => x.id !== p.id))}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      }
                    >
                      <ListItemText primary={locale === 'en' && p.name_en ? p.name_en : p.name} secondary={p.sku} />
                    </ListItem>
                  ))}
                </List>
              )}
            </Stack>
          )}
        </Stack>
      </GlassCard>
      <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
        <GlassButton variant="outlined" onClick={() => router.push('/inventory/stock-takes')} disabled={create.isPending}>
          {tc('cancel')}
        </GlassButton>
        <GlassButton onClick={submit} loading={create.isPending} disabled={!valid}>
          {t('startStockTake')}
        </GlassButton>
      </Stack>
    </Stack>
  );
}

export default function NewStockTakePage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <NewStockTakeContent />
    </RequireAuth>
  );
}
