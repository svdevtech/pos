'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { Role } from '@/lib/auth/session';
import { useSession } from './Providers';

interface Props {
  children: ReactNode;
  /** When given, the user must have one of these roles. */
  roles?: readonly Role[];
}

export function FullPageLoader() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress />
    </Box>
  );
}

export default function RequireAuth({ children, roles }: Props) {
  const { session, ready, hasRole } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('common');

  useEffect(() => {
    if (ready && !session) {
      const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login${next}`);
    }
  }, [ready, session, router, pathname]);

  if (!ready || !session) return <FullPageLoader />;

  if (roles && roles.length > 0 && !hasRole(...roles)) {
    return (
      <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center', textAlign: 'center', p: 3 }}>
        <Box>
          <Typography variant="h5" gutterBottom>
            {t('forbidden')}
          </Typography>
          <Button variant="outlined" onClick={() => router.replace('/')}>
            {t('home')}
          </Button>
        </Box>
      </Box>
    );
  }

  return <>{children}</>;
}
