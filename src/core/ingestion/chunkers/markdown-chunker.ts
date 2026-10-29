import type { Chunk, Chunker, Document } from '../../types';
import { splitText, type SplitOptions } from './split-text';

interface Section {
  headings: string[];
  body: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

function parseHeading(line: string): { level: number; title: string } | null {
  const match = HEADING.exec(line);
  if (!match) return null;
  const [, hashes = '', title = ''] = match;
  return { level: hashes.length, title };
}

function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let headings: string[] = [];
  let lines: string[] = [];
  let insideFence = false;

  const flush = (): void => {
    const body = lines.join('\n').trim();
    if (body) sections.push({ headings, body });
    lines = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) insideFence = !insideFence;
    const heading = insideFence ? null : parseHeading(line);
    if (!heading) {
      lines.push(line);
      continue;
    }
    flush();
    headings = [...headings.slice(0, heading.level - 1), heading.title];
  }
  flush();
  return sections;
}

/**
 * Quebra por seção e prefixa cada chunk com o caminho de títulos
 * ("Assinatura > Cancelamento"). Sem esse prefixo, um trecho como
 * "clique em Confirmar" perde o assunto e o embedding fica genérico.
 */
export class MarkdownChunker implements Chunker {
  constructor(private readonly options: SplitOptions) {}

  chunk(document: Document): Chunk[] {
    const chunks: Chunk[] = [];
    for (const { headings, body } of splitSections(document.text)) {
      const breadcrumb = headings.filter(Boolean).join(' > ');
      const prefix = breadcrumb ? `${breadcrumb}\n\n` : '';
      const size = Math.max(this.options.size - prefix.length, this.options.overlap + 1);
      for (const piece of splitText(body, { ...this.options, size })) {
        chunks.push({
          documentId: document.id,
          index: chunks.length,
          text: `${prefix}${piece}`,
          metadata: breadcrumb ? { ...document.metadata, section: breadcrumb } : document.metadata,
        });
      }
    }
    return chunks;
  }
}
