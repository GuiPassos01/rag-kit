import { CollectionNotFoundError, EmbeddingMismatchError } from '../../errors';
import type {
  CollectionInfo,
  EmbeddedChunk,
  Metadata,
  SearchHit,
  SearchOptions,
  StoredDocument,
  VectorStore,
} from '../../types';

interface StoredChunk extends EmbeddedChunk {
  id: string;
}

interface Collection {
  info: CollectionInfo;
  documents: Map<string, StoredDocument>;
  chunks: Map<string, StoredChunk[]>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function matchesFilter(metadata: Metadata, filter: Metadata | undefined): boolean {
  return Object.entries(filter ?? {}).every(([key, value]) => metadata[key] === value);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 2);
}

/** Store em memória, sem persistência: serve para testes e para entender a mecânica. */
export class MemoryStore implements VectorStore {
  private readonly collections = new Map<string, Collection>();

  async ensureCollection(info: CollectionInfo): Promise<void> {
    const existing = this.collections.get(info.name);
    if (!existing) {
      this.collections.set(info.name, { info, documents: new Map(), chunks: new Map() });
      return;
    }
    if (existing.info.embeddingModel !== info.embeddingModel) {
      throw new EmbeddingMismatchError(
        `A coleção "${info.name}" foi indexada com "${existing.info.embeddingModel}", não com "${info.embeddingModel}".`,
      );
    }
  }

  async deleteCollection(name: string): Promise<void> {
    this.collections.delete(name);
  }

  async getDocumentHashes(collection: string): Promise<Map<string, string>> {
    const documents = this.get(collection).documents.values();
    return new Map([...documents].map((document) => [document.id, document.contentHash]));
  }

  async replaceDocument(
    collection: string,
    document: StoredDocument,
    chunks: EmbeddedChunk[],
  ): Promise<void> {
    const target = this.get(collection);
    target.documents.set(document.id, document);
    target.chunks.set(
      document.id,
      chunks.map((chunk) => ({ ...chunk, id: `${document.id}:${chunk.index}` })),
    );
  }

  async deleteDocuments(collection: string, ids: string[]): Promise<void> {
    const target = this.get(collection);
    for (const id of ids) {
      target.documents.delete(id);
      target.chunks.delete(id);
    }
  }

  async searchByVector(
    collection: string,
    embedding: number[],
    { limit, filter }: SearchOptions,
  ): Promise<SearchHit[]> {
    return this.allChunks(collection, filter)
      .map((chunk) => toHit(chunk, cosineSimilarity(embedding, chunk.embedding)))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async searchByText(collection: string, query: string, { limit, filter }: SearchOptions): Promise<SearchHit[]> {
    const terms = new Set(tokenize(query));
    return this.allChunks(collection, filter)
      .map((chunk) => toHit(chunk, tokenize(chunk.text).filter((term) => terms.has(term)).length))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private allChunks(collection: string, filter: Metadata | undefined): StoredChunk[] {
    return [...this.get(collection).chunks.values()]
      .flat()
      .filter((chunk) => matchesFilter(chunk.metadata, filter));
  }

  private get(collection: string): Collection {
    const found = this.collections.get(collection);
    if (!found) throw new CollectionNotFoundError(collection);
    return found;
  }
}

function toHit(chunk: StoredChunk, score: number): SearchHit {
  return { id: chunk.id, documentId: chunk.documentId, text: chunk.text, metadata: chunk.metadata, score };
}
