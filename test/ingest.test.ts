import { describe, expect, test } from 'bun:test';

import { EmbeddingMismatchError, ingest, MarkdownChunker, MemoryStore } from '../src/core';
import { arrayLoader, FakeEmbedder, markdownDoc } from './fakes';

function setup() {
  const store = new MemoryStore();
  const embedder = new FakeEmbedder();
  const deps = { store, embedder, chunker: new MarkdownChunker({ size: 500, overlap: 50 }) };
  return { store, embedder, deps };
}

const docA = markdownDoc('a.md', '# A\n\nconteúdo do documento a');
const docB = markdownDoc('b.md', '# B\n\nconteúdo do documento b');

describe('ingest', () => {
  test('indexa documentos novos', async () => {
    const { deps, store } = setup();
    const report = await ingest(deps, { collection: 'c', loader: arrayLoader([docA, docB]) });
    expect(report).toMatchObject({ added: 2, updated: 0, unchanged: 0, removed: 0, chunks: 2 });
    expect([...(await store.getDocumentHashes('c')).keys()]).toEqual(['a.md', 'b.md']);
  });

  test('junta os trechos de vários documentos numa chamada de embedding', async () => {
    const { deps, embedder } = setup();
    await ingest(deps, { collection: 'c', loader: arrayLoader([docA, docB]) });
    expect(embedder.calls).toBe(1);
  });

  test('não reprocessa o que não mudou', async () => {
    const { deps, embedder } = setup();
    await ingest(deps, { collection: 'c', loader: arrayLoader([docA, docB]) });
    const callsBefore = embedder.calls;
    const report = await ingest(deps, { collection: 'c', loader: arrayLoader([docA, docB]) });
    expect(report).toMatchObject({ added: 0, updated: 0, unchanged: 2 });
    expect(embedder.calls).toBe(callsBefore);
  });

  test('reindexa só o documento alterado', async () => {
    const { deps } = setup();
    await ingest(deps, { collection: 'c', loader: arrayLoader([docA, docB]) });
    const changed = markdownDoc('a.md', '# A\n\nconteúdo novo');
    const report = await ingest(deps, { collection: 'c', loader: arrayLoader([changed, docB]) });
    expect(report).toMatchObject({ added: 0, updated: 1, unchanged: 1 });
  });

  test('remove o que sumiu da fonte, a não ser com prune desligado', async () => {
    const { deps, store } = setup();
    await ingest(deps, { collection: 'c', loader: arrayLoader([docA, docB]) });

    const kept = await ingest(deps, { collection: 'c', loader: arrayLoader([docA]), prune: false });
    expect(kept.removed).toBe(0);

    const pruned = await ingest(deps, { collection: 'c', loader: arrayLoader([docA]) });
    expect(pruned.removed).toBe(1);
    expect([...(await store.getDocumentHashes('c')).keys()]).toEqual(['a.md']);
  });

  test('documento sem texto não entra e sai do índice se existia', async () => {
    const { deps, store } = setup();
    await ingest(deps, { collection: 'c', loader: arrayLoader([docA]) });
    const report = await ingest(deps, { collection: 'c', loader: arrayLoader([markdownDoc('a.md', '   ')]) });
    expect(report).toMatchObject({ empty: 1, removed: 1 });
    expect((await store.getDocumentHashes('c')).size).toBe(0);
  });

  test('recusa indexar com outro modelo de embedding', async () => {
    const { deps } = setup();
    await ingest(deps, { collection: 'c', loader: arrayLoader([docA]) });
    const otherModel = { ...deps, embedder: new FakeEmbedder('outro-modelo') };
    expect(ingest(otherModel, { collection: 'c', loader: arrayLoader([docA]) })).rejects.toBeInstanceOf(
      EmbeddingMismatchError,
    );
  });
});
