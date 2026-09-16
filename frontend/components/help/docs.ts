import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HelpDoc } from '@/components/help/HelpView';

/** The manuals shipped inside the image (see npm run docs:sync), in the order they are offered. */
const FILES: { id: string; labelKey: string; file: string }[] = [
  { id: 'user-guide', labelKey: 'userGuide', file: 'user-guide.md' },
  { id: 'fnb-user-guide', labelKey: 'fnbGuide', file: 'fnb-user-guide.md' },
  { id: 'dividend-math', labelKey: 'dividendMath', file: 'dividend-math.md' },
];

/** Reads them off disk at build time; a manual that is missing is simply not offered. */
export function loadHelpDocs(): HelpDoc[] {
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
