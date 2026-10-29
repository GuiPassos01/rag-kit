import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

import { LoaderError } from '../../errors';
import type { Document, Loader } from '../../types';
import { parseMarkdown, parsePlainText } from './markdown';
import { parsePdf } from './pdf';

type Parser = (path: string, bytes: Buffer) => Promise<Document[]>;

const PARSERS: Readonly<Record<string, Parser>> = {
  '.md': async (path, bytes) => [parseMarkdown(path, bytes.toString('utf8'))],
  '.markdown': async (path, bytes) => [parseMarkdown(path, bytes.toString('utf8'))],
  '.txt': async (path, bytes) => [parsePlainText(path, bytes.toString('utf8'))],
  '.pdf': (path, bytes) => parsePdf(path, new Uint8Array(bytes)),
};

export const SUPPORTED_EXTENSIONS = Object.keys(PARSERS);

/** Lê uma pasta recursivamente. O id de cada documento é o caminho relativo à pasta. */
export class DirectoryLoader implements Loader {
  constructor(private readonly root: string) {}

  async *load(): AsyncIterable<Document> {
    const rootStat = await stat(this.root).catch(() => null);
    if (!rootStat?.isDirectory()) {
      throw new LoaderError(`Pasta "${this.root}" não existe.`);
    }

    const entries = await readdir(this.root, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && PARSERS[extname(entry.name).toLowerCase()])
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();

    for (const file of files) {
      const parse = PARSERS[extname(file).toLowerCase()];
      if (!parse) continue;
      const path = relative(this.root, file).split(sep).join('/');
      yield* await parse(path, await readFile(file));
    }
  }
}
