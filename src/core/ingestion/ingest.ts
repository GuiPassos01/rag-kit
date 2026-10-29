import type { Chunk, Chunker, Document, EmbeddedChunk, Embedder, Loader, VectorStore } from '../types';

export interface IngestDependencies {
  store: VectorStore;
  embedder: Embedder;
  chunker: Chunker;
}

export interface IngestOptions {
  collection: string;
  loader: Loader;
  /** Remove do índice os documentos que sumiram da fonte. */
  prune?: boolean;
  onProgress?: (event: IngestEvent) => void;
}

export type IngestEvent =
  | { type: 'added' | 'updated'; documentId: string; chunks: number }
  | { type: 'unchanged' | 'empty'; documentId: string }
  | { type: 'removed'; documentIds: string[] };

export interface IngestReport {
  added: number;
  updated: number;
  unchanged: number;
  empty: number;
  removed: number;
  chunks: number;
}

/** Documentos pequenos não enchem um lote sozinhos: os trechos de vários vão juntos para o embedder. */
const EMBED_BATCH_CHUNKS = 50;

interface PendingDocument<TChunk = Chunk> {
  document: Document;
  contentHash: string;
  chunks: TChunk[];
}

export function hashContent(document: Document): string {
  return new Bun.CryptoHasher('sha256')
    .update(document.text)
    .update(JSON.stringify(document.metadata))
    .digest('hex');
}

const countChunks = (batch: PendingDocument[]): number => batch.reduce((sum, { chunks }) => sum + chunks.length, 0);

/** Uma chamada ao embedder para o lote inteiro; os vetores voltam redistribuídos por documento. */
async function embedBatch(embedder: Embedder, batch: PendingDocument[]): Promise<PendingDocument<EmbeddedChunk>[]> {
  const embeddings = await embedder.embedDocuments(batch.flatMap(({ chunks }) => chunks.map((chunk) => chunk.text)));
  let next = 0;
  return batch.map((pending) => ({
    ...pending,
    chunks: pending.chunks.map((chunk) => ({ ...chunk, embedding: embeddings[next++] ?? [] })),
  }));
}

export async function ingest(
  { store, embedder, chunker }: IngestDependencies,
  { collection, loader, prune = true, onProgress }: IngestOptions,
): Promise<IngestReport> {
  await store.ensureCollection({
    name: collection,
    embeddingModel: embedder.model,
    dimensions: embedder.dimensions,
  });

  const existing = await store.getDocumentHashes(collection);
  const seen = new Set<string>();
  const report = { added: 0, updated: 0, unchanged: 0, empty: 0, removed: 0, chunks: 0 };

  const save = async (batch: PendingDocument[]): Promise<void> => {
    for (const { document, contentHash, chunks } of await embedBatch(embedder, batch)) {
      await store.replaceDocument(collection, { id: document.id, contentHash, metadata: document.metadata }, chunks);

      const type = existing.has(document.id) ? 'updated' : 'added';
      report[type]++;
      report.chunks += chunks.length;
      onProgress?.({ type, documentId: document.id, chunks: chunks.length });
    }
  };

  let pending: PendingDocument[] = [];
  for await (const document of loader.load()) {
    seen.add(document.id);
    const contentHash = hashContent(document);
    if (existing.get(document.id) === contentHash) {
      report.unchanged++;
      onProgress?.({ type: 'unchanged', documentId: document.id });
      continue;
    }

    const chunks = chunker.chunk(document);
    if (chunks.length === 0) {
      // Sem texto (ex.: PDF escaneado sem OCR): some do índice em vez de ficar desatualizado.
      seen.delete(document.id);
      report.empty++;
      onProgress?.({ type: 'empty', documentId: document.id });
      continue;
    }

    pending.push({ document, contentHash, chunks });
    if (countChunks(pending) >= EMBED_BATCH_CHUNKS) {
      await save(pending);
      pending = [];
    }
  }
  if (pending.length > 0) await save(pending);

  if (prune) {
    const missing = [...existing.keys()].filter((id) => !seen.has(id));
    if (missing.length > 0) {
      await store.deleteDocuments(collection, missing);
      report.removed = missing.length;
      onProgress?.({ type: 'removed', documentIds: missing });
    }
  }

  return report;
}
