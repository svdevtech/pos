'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/components/Providers';
import { FullPageLoader } from '@/components/RequireAuth';

/** Landing route: sends the user to the right place based on their session. */
export default function Home() {
  const { session, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if (session.user.must_reset_password) router.replace('/settings/password');
    else if (session.user.role === 'platform_admin') router.replace('/admin/stores');
    else if (session.user.role === 'cashier') router.replace('/pos');
    else router.replace('/dashboard');
  }, [ready, session, router]);

  return <FullPageLoader />;
}
