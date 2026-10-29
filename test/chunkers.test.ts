import { describe, expect, test } from 'bun:test';

import { FixedSizeChunker, MarkdownChunker, MediaTypeChunker, splitText } from '../src/core';
import { markdownDoc } from './fakes';

const LONG_TEXT = Array.from({ length: 60 }, (_, i) => `Esta é a frase número ${i} do documento.`).join(' ');

describe('splitText', () => {
  test('devolve o texto inteiro quando cabe num pedaço', () => {
    expect(splitText('  curto  ', { size: 100, overlap: 10 })).toEqual(['curto']);
  });

  test('devolve lista vazia para texto em branco', () => {
    expect(splitText(' \n\n ', { size: 100, overlap: 10 })).toEqual([]);
  });

  test('nenhum pedaço passa do tamanho e cortes caem em fim de frase', () => {
    const pieces = splitText(LONG_TEXT, { size: 200, overlap: 0 });
    expect(pieces.length).toBeGreaterThan(5);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(200);
      expect(piece.endsWith('.')).toBe(true);
    }
  });

  test('a sobreposição repete o fim do pedaço anterior', () => {
    const [first, second] = splitText(LONG_TEXT, { size: 200, overlap: 60 });
    const firstTail = first?.slice(-30) ?? '';
    expect(second).toContain(firstTail.trim().split(' ').slice(-2).join(' '));
  });

  test('cobre o texto inteiro', () => {
    const pieces = splitText(LONG_TEXT, { size: 150, overlap: 0 });
    expect(pieces.join(' ')).toBe(LONG_TEXT);
  });

  test('rejeita overlap maior ou igual ao tamanho', () => {
    expect(() => splitText(LONG_TEXT, { size: 100, overlap: 100 })).toThrow(RangeError);
  });
});

describe('MarkdownChunker', () => {
  const chunker = new MarkdownChunker({ size: 500, overlap: 50 });

  test('prefixa cada chunk com o caminho de títulos', () => {
    const chunks = chunker.chunk(
      markdownDoc('guia.md', '# Assinatura\n\nIntro.\n\n## Cancelamento\n\nAcesse Configurações.\n\n## Troca de plano\n\nEscolha o plano.'),
    );
    expect(chunks.map((chunk) => chunk.metadata.section)).toEqual([
      'Assinatura',
      'Assinatura > Cancelamento',
      'Assinatura > Troca de plano',
    ]);
    expect(chunks[1]?.text).toBe('Assinatura > Cancelamento\n\nAcesse Configurações.');
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
  });

  test('ignora "#" dentro de bloco de código', () => {
    const chunks = chunker.chunk(markdownDoc('a.md', '# Script\n\n```bash\n# comentário\necho oi\n```'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toContain('# comentário');
  });

  test('subir de nível descarta os títulos mais profundos', () => {
    const chunks = chunker.chunk(markdownDoc('a.md', '# A\n## B\n### C\ntexto c\n## D\ntexto d'));
    expect(chunks.map((chunk) => chunk.metadata.section)).toEqual(['A > B > C', 'A > D']);
  });
});

describe('MediaTypeChunker', () => {
  test('usa o chunker do tipo e cai no padrão para os outros', () => {
    const chunker = new MediaTypeChunker(
      { 'text/markdown': new MarkdownChunker({ size: 500, overlap: 0 }) },
      new FixedSizeChunker({ size: 500, overlap: 0 }),
    );
    const markdown = chunker.chunk(markdownDoc('a.md', '# T\n\ncorpo'));
    const plain = chunker.chunk({ id: 'a.txt', text: '# T\n\ncorpo', mediaType: 'text/plain', metadata: {} });
    expect(markdown[0]?.metadata.section).toBe('T');
    expect(plain[0]?.text).toBe('# T\n\ncorpo');
  });
});
