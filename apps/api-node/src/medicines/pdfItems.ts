// Reads positioned text items from a PDF with pdfjs-dist (a dev dependency: only the import script loads this file).
// Kept separate from the parser so the parser, and every test, never needs the private PDF.
import { readFileSync } from 'node:fs';
import type { PageItems } from './nlemParser.js';

export async function readPdfItems(path: string): Promise<PageItems[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const pages: PageItems[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items = content.items.flatMap((item) =>
      'str' in item && item.str.trim() !== ''
        ? [
            {
              str: item.str,
              x: Number(item.transform[4]),
              y: Number(item.transform[5]),
              width: item.width,
            },
          ]
        : [],
    );
    pages.push({ page: n, items });
  }
  await doc.destroy();
  return pages;
}
