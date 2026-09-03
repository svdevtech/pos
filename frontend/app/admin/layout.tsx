'use client';

import type { ReactNode } from 'react';
import DashboardShell from '@/components/DashboardShell';
import RequireAuth from '@/components/RequireAuth';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth roles={['platform_admin']}>
      <DashboardShell>{children}</DashboardShell>
    </RequireAuth>
  );
}
