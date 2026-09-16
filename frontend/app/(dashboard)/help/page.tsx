import StoreHelpView from '@/components/help/StoreHelpView';
import { loadHelpDocs } from '@/components/help/docs';

export const dynamic = 'force-static';

export default function HelpPage() {
  return <StoreHelpView docs={loadHelpDocs()} />;
}
