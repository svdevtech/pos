'use client';

import type { ReactNode } from 'react';
import DashboardShell from '@/components/DashboardShell';
import RequireAuth from '@/components/RequireAuth';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <DashboardShell>{children}</DashboardShell>
    </RequireAuth>
  );
}
