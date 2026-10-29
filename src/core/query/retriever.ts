import { excerpt, sourceLabel } from './prompt';
import type {
  Embedder,
  Metadata,
  RetrievedChunk,
  SearchHit,
  SearchOptions,
  TracedHit,
  TraceEvent,
  VectorStore,
} from '../types';
import { reciprocalRankFusion } from './rrf';

export interface RetrievalOptions {
  topK: number;
  /** Quantos candidatos cada busca traz antes da fusão. */
  candidates: number;
  /** Abaixo disso, o trecho da busca vetorial é descartado. Depende do modelo de embedding. */
  minSimilarity: number;
  hybrid: boolean;
}

type OnTrace = (event: TraceEvent) => void;

export interface RetrieveRequest {
  collection: string;
  query: string;
  topK?: number;
  filter?: Metadata;
  onTrace?: OnTrace;
}

const EMBEDDING_PREVIEW = 12;

async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await run();
  return [result, Math.round(performance.now() - start)];
}

function toTraced(hit: SearchHit): TracedHit {
  return { id: hit.id, documentId: hit.documentId, label: sourceLabel(hit), score: hit.score, excerpt: excerpt(hit.text, 160) };
}

function rankById(hits: SearchHit[]): Map<string, number> {
  return new Map(hits.map((hit, i) => [hit.id, i + 1]));
}

export class Retriever {
  constructor(
    private readonly store: VectorStore,
    private readonly embedder: Embedder,
    private readonly options: RetrievalOptions,
  ) {}

  async retrieve({ collection, query, topK, filter, onTrace }: RetrieveRequest): Promise<RetrievedChunk[]> {
    const search: SearchOptions = { limit: this.options.candidates, ...(filter && { filter }) };

    // A full-text não depende do vetor: começa junto com o embedding.
    const textSearch = timed(() => this.searchText(collection, query, search));
    // Se o embedding falhar, ninguém espera pela textSearch: sem isso, uma falha dela vira unhandledRejection.
    textSearch.catch(() => {});

    const embedding = await this.embedQuery(query, onTrace);
    const [vectorHits, textHits] = await Promise.all([
      this.searchVector(collection, embedding, search, onTrace),
      // O trace sai depois do de embedding, na ordem do pipeline, mesmo que a busca tenha terminado antes.
      textSearch.then(([hits, ms]) => {
        onTrace?.({ stage: 'text-search', enabled: this.options.hybrid, hits: hits.map(toTraced), ms });
        return hits;
      }),
    ]);

    return this.fuse(vectorHits, textHits, topK ?? this.options.topK, onTrace);
  }

  private isRelevant(hit: SearchHit): boolean {
    return hit.score >= this.options.minSimilarity;
  }

  private async embedQuery(query: string, onTrace: OnTrace | undefined): Promise<number[]> {
    const [embedding, ms] = await timed(() => this.embedder.embedQuery(query));
    onTrace?.({
      stage: 'embedding',
      model: this.embedder.model,
      dimensions: embedding.length,
      preview: embedding.slice(0, EMBEDDING_PREVIEW),
      ms,
    });
    return embedding;
  }

  private async searchVector(
    collection: string,
    embedding: number[],
    search: SearchOptions,
    onTrace: OnTrace | undefined,
  ): Promise<SearchHit[]> {
    const [hits, ms] = await timed(() => this.store.searchByVector(collection, embedding, search));
    onTrace?.({
      stage: 'vector-search',
      minSimilarity: this.options.minSimilarity,
      hits: hits.map((hit) => ({ ...toTraced(hit), kept: this.isRelevant(hit) })),
      ms,
    });
    return hits;
  }

  private searchText(collection: string, query: string, search: SearchOptions): Promise<SearchHit[]> {
    return this.options.hybrid ? this.store.searchByText(collection, query, search) : Promise.resolve([]);
  }

  /**
   * Os vetoriais abaixo do mínimo ficam fora da fusão, mas a similaridade deles
   * ainda aparece nos trechos que entraram pela busca textual.
   */
  private fuse(
    vectorHits: SearchHit[],
    textHits: SearchHit[],
    topK: number,
    onTrace: OnTrace | undefined,
  ): RetrievedChunk[] {
    const relevant = vectorHits.filter((hit) => this.isRelevant(hit));
    const similarityById = new Map(vectorHits.map((hit) => [hit.id, hit.score]));

    const chunks = reciprocalRankFusion([relevant, textHits])
      .slice(0, topK)
      .map(({ hit, score }) => ({ ...hit, score, similarity: similarityById.get(hit.id) ?? null }));

    if (onTrace) {
      const vectorRanks = rankById(relevant);
      const textRanks = rankById(textHits);
      onTrace({
        stage: 'fusion',
        topK,
        hits: chunks.map((chunk) => ({
          ...toTraced(chunk),
          similarity: chunk.similarity,
          vectorRank: vectorRanks.get(chunk.id) ?? null,
          textRank: textRanks.get(chunk.id) ?? null,
        })),
      });
    }
    return chunks;
  }
}
