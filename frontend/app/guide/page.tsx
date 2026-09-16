import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import HelpView from '@/components/help/HelpView';
import { loadHelpDocs } from '@/components/help/docs';

export const dynamic = 'force-static';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('help');
  return { title: t('title'), description: t('subtitle') };
}

/** Every manual, readable without an account. */
export default function PublicGuidePage() {
  return <HelpView docs={loadHelpDocs()} back={{ href: '/login', labelKey: 'backToLogin' }} />;
}
