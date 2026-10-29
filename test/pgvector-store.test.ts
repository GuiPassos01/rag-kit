import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { EmbeddingMismatchError, ingest, MarkdownChunker, PgVectorStore } from '../src/core';
import { arrayLoader, FakeEmbedder, markdownDoc } from './fakes';

// Integração: só roda com um Postgres de pé (bun run db:up) e TEST_DATABASE_URL definido.
const url = process.env.TEST_DATABASE_URL;
const COLLECTION = `test-${Date.now()}`;

describe.skipIf(!url)('PgVectorStore', () => {
  const embedder = new FakeEmbedder();
  let store: PgVectorStore;

  beforeAll(async () => {
    store = await PgVectorStore.connect({ url: url ?? '', dimensions: embedder.dimensions, textSearchConfig: 'portuguese' });
    await ingest(
      { store, embedder, chunker: new MarkdownChunker({ size: 500, overlap: 50 }) },
      {
        collection: COLLECTION,
        loader: arrayLoader([
          markdownDoc('cancelamento.md', '# Cancelamento\n\nPara cancelar a assinatura acesse configurações.'),
          { ...markdownDoc('erros.md', '# Erros\n\nO erro E4012 indica cartão recusado.'), metadata: { source: 'erros.md', plano: 'pro' } },
        ]),
      },
    );
  });

  afterAll(async () => {
    await store.deleteCollection(COLLECTION);
    await store.close();
  });

  test('busca vetorial devolve o mais parecido primeiro', async () => {
    const hits = await store.searchByVector(COLLECTION, await embedder.embedQuery('cancelar assinatura'), { limit: 2 });
    expect(hits[0]?.documentId).toBe('cancelamento.md');
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  test('full-text acha termo exato e aplica stemming', async () => {
    expect((await store.searchByText(COLLECTION, 'E4012', { limit: 5 }))[0]?.documentId).toBe('erros.md');
    expect((await store.searchByText(COLLECTION, 'cancelamentos', { limit: 5 }))[0]?.documentId).toBe('cancelamento.md');
  });

  test('filtro por metadado', async () => {
    const hits = await store.searchByVector(COLLECTION, await embedder.embedQuery('assinatura'), {
      limit: 5,
      filter: { plano: 'pro' },
    });
    expect(hits.map((hit) => hit.documentId)).toEqual(['erros.md']);
  });

  test('trava a coleção no modelo de embedding', async () => {
    expect(
      store.ensureCollection({ name: COLLECTION, embeddingModel: 'outro', dimensions: embedder.dimensions }),
    ).rejects.toBeInstanceOf(EmbeddingMismatchError);
  });
});
