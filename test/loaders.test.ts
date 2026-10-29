import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DirectoryLoader, LoaderError, parseMarkdown, type Document } from '../src/core';

describe('parseMarkdown', () => {
  test('frontmatter vira metadado e o título vem do primeiro H1', () => {
    const document = parseMarkdown('faq.md', '---\nplano: enterprise\nprioridade: 2\nativo: true\n---\n# Perguntas frequentes\n\nCorpo.');
    expect(document.metadata).toEqual({
      plano: 'enterprise',
      prioridade: 2,
      ativo: true,
      source: 'faq.md',
      title: 'Perguntas frequentes',
    });
    expect(document.text.startsWith('# Perguntas frequentes')).toBe(true);
  });

  test('sem H1, o título é o nome do arquivo', () => {
    expect(parseMarkdown('pasta/sem-titulo.md', 'texto').metadata.title).toBe('sem-titulo');
  });
});

describe('DirectoryLoader', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'rag-kit-'));
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'b.md'), '# B');
    await writeFile(join(root, 'sub', 'a.txt'), 'texto a');
    await writeFile(join(root, 'ignorado.json'), '{}');
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  test('lê os formatos suportados com id relativo e barra normal', async () => {
    const documents: Document[] = [];
    for await (const document of new DirectoryLoader(root).load()) documents.push(document);
    expect(documents.map((document) => [document.id, document.mediaType])).toEqual([
      ['b.md', 'text/markdown'],
      ['sub/a.txt', 'text/plain'],
    ]);
  });

  test('falha com mensagem clara se a pasta não existe', async () => {
    const iterator = new DirectoryLoader(join(root, 'nao-existe')).load()[Symbol.asyncIterator]();
    expect(iterator.next()).rejects.toBeInstanceOf(LoaderError);
  });
});
