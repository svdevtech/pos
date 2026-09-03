import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import HelpView, { type HelpDoc } from '@/components/help/HelpView';

// Manuals are shipped inside the image (see npm run docs:sync).
const FILES: { id: string; labelKey: string; file: string }[] = [
  { id: 'user-guide', labelKey: 'userGuide', file: 'user-guide.md' },
  { id: 'dividend-math', labelKey: 'dividendMath', file: 'dividend-math.md' },
];

function load(): HelpDoc[] {
  const dir = join(process.cwd(), 'content', 'help');
  return FILES.map(({ id, labelKey, file }) => {
    let markdown = '';
    try {
      markdown = readFileSync(join(dir, file), 'utf8');
    } catch {
      markdown = '';
    }
    return { id, labelKey, markdown };
  }).filter((d) => d.markdown.trim().length > 0);
}

export const dynamic = 'force-static';

export default function HelpPage() {
  return <HelpView docs={load()} />;
}
