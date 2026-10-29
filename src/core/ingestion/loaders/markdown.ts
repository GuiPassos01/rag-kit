import { basename, extname } from 'node:path';

import type { Document, Metadata, MetadataValue } from '../../types';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Frontmatter simples (`chave: valor` por linha) vira metadado filtrável,
 * ex.: `plano: enterprise`. Não é um parser YAML completo, de propósito.
 */
function parseFrontmatter(raw: string): Record<string, MetadataValue> {
  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.match(/^([\w-]+):\s*(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(([, key = '', value = '']) => [key, parseScalar(value.trim())] as const);
  return Object.fromEntries(entries);
}

function parseScalar(value: string): MetadataValue {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === '' || value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/^["']|["']$/g, '');
}

function titleFrom(body: string, path: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1];
  return heading?.trim() ?? basename(path, extname(path));
}

export function parseMarkdown(path: string, content: string): Document {
  const frontmatter = content.match(FRONTMATTER);
  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  const metadata: Metadata = {
    ...(frontmatter?.[1] ? parseFrontmatter(frontmatter[1]) : {}),
    source: path,
    title: titleFrom(body, path),
  };
  return { id: path, text: body, mediaType: 'text/markdown', metadata };
}

export function parsePlainText(path: string, content: string): Document {
  return {
    id: path,
    text: content,
    mediaType: 'text/plain',
    metadata: { source: path, title: basename(path, extname(path)) },
  };
}
