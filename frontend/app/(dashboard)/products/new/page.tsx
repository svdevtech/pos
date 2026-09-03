'use client';

import Stack from '@mui/material/Stack';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import ProductForm, { toProductInput } from '@/components/products/ProductForm';
import { useCreateProduct } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';

function NewProductContent() {
  const t = useTranslations('products');
  const router = useRouter();
  const toast = useToast();
  const create = useCreateProduct();

  return (
    <Stack spacing={3} sx={{ maxWidth: 980 }}>
      <PageHeader title={t('addProduct')} backHref="/products" />
      <ProductForm
        mode="create"
        submitting={create.isPending}
        error={create.error}
        onCancel={() => router.push('/products')}
        onSubmit={(values) =>
          create.mutate(toProductInput(values, 'create'), {
            onSuccess: (p) => {
              toast.success(t('created'));
              router.replace(`/products/${p.id}`);
            },
          })
        }
      />
    </Stack>
  );
}

export default function NewProductPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <NewProductContent />
    </RequireAuth>
  );
}
