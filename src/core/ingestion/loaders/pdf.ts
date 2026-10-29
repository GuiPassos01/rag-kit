import { basename, extname } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

import { describeError, LoaderError } from '../../errors';
import type { Document } from '../../types';

/** Uma página vira um documento: assim a citação aponta a página certa. */
export async function parsePdf(path: string, bytes: Uint8Array): Promise<Document[]> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const title = basename(path, extname(path));
    return pages
      .map((text, index) => ({ text, page: index + 1 }))
      .filter(({ text }) => text.trim().length > 0)
      .map(({ text, page }) => ({
        id: `${path}#page=${page}`,
        text,
        mediaType: 'application/pdf' as const,
        metadata: { source: path, title, page },
      }));
  } catch (error) {
    throw new LoaderError(`Falha ao ler o PDF "${path}": ${describeError(error)}`, {
      cause: error,
    });
  }
}
