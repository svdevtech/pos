'use client';

import Stack from '@mui/material/Stack';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import MemberForm, { toMemberInput } from '@/components/members/MemberForm';
import { useCreateMember } from '@/lib/api/hooks/members';
import { MUTATING_ROLES } from '@/lib/auth/session';

function NewMemberContent() {
  const t = useTranslations('members');
  const router = useRouter();
  const toast = useToast();
  const create = useCreateMember();

  return (
    <Stack spacing={3} sx={{ maxWidth: 980 }}>
      <PageHeader title={t('addMember')} backHref="/members" />
      <MemberForm
        mode="create"
        submitting={create.isPending}
        error={create.error}
        onCancel={() => router.push('/members')}
        onSubmit={(values) =>
          create.mutate(toMemberInput(values), {
            onSuccess: (m) => {
              toast.success(t('created'));
              router.replace(`/members/${m.id}`);
            },
          })
        }
      />
    </Stack>
  );
}

export default function NewMemberPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <NewMemberContent />
    </RequireAuth>
  );
}
