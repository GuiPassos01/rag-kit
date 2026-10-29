export type MetadataValue = string | number | boolean | null;
export type Metadata = Readonly<Record<string, MetadataValue>>;

export type MediaType = 'text/markdown' | 'text/plain' | 'application/pdf';

/** Unidade que o loader entrega: um arquivo .md, ou uma página de PDF. */
export interface Document {
  id: string;
  text: string;
  mediaType: MediaType;
  metadata: Metadata;
}

export interface Chunk {
  documentId: string;
  index: number;
  text: string;
  metadata: Metadata;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export interface SearchHit {
  id: string;
  documentId: string;
  text: string;
  metadata: Metadata;
  score: number;
}

export interface RetrievedChunk extends SearchHit {
  /** Similaridade de cosseno, quando o trecho veio da busca vetorial. */
  similarity: number | null;
}

export interface Loader {
  load(): AsyncIterable<Document>;
}

export interface Chunker {
  chunk(document: Document): Chunk[];
}

export interface Embedder {
  model: string;
  dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export interface ChatPrompt {
  system: string;
  user: string;
}

export interface Llm {
  model: string;
  /** `signal` cancela a geração no provedor, ex.: quando o cliente desconecta. */
  stream(prompt: ChatPrompt, signal?: AbortSignal): AsyncIterable<string>;
}

export interface CollectionInfo {
  name: string;
  embeddingModel: string;
  dimensions: number;
}

export interface StoredDocument {
  id: string;
  contentHash: string;
  metadata: Metadata;
}

export interface SearchOptions {
  limit: number;
  filter?: Metadata;
}

export interface VectorStore {
  ensureCollection(info: CollectionInfo): Promise<void>;
  deleteCollection(name: string): Promise<void>;
  getDocumentHashes(collection: string): Promise<Map<string, string>>;
  replaceDocument(
    collection: string,
    document: StoredDocument,
    chunks: EmbeddedChunk[],
  ): Promise<void>;
  deleteDocuments(collection: string, ids: string[]): Promise<void>;
  searchByVector(
    collection: string,
    embedding: number[],
    options: SearchOptions,
  ): Promise<SearchHit[]>;
  searchByText(
    collection: string,
    query: string,
    options: SearchOptions,
  ): Promise<SearchHit[]>;
}

/** Um trecho como aparece no trace: o suficiente para mostrar, sem o texto inteiro. */
export interface TracedHit {
  id: string;
  documentId: string;
  label: string;
  score: number;
  excerpt: string;
}

export interface FusedHit extends TracedHit {
  similarity: number | null;
  /** Posição (1-based) na lista vetorial já filtrada pelo limiar; null se não estava nela. */
  vectorRank: number | null;
  textRank: number | null;
}

/** O que aconteceu em cada etapa da consulta, para quem quiser observar o pipeline. */
export type TraceEvent =
  | {
      stage: 'embedding';
      model: string;
      dimensions: number;
      preview: number[];
      ms: number;
    }
  | {
      stage: 'vector-search';
      minSimilarity: number;
      hits: (TracedHit & { kept: boolean })[];
      ms: number;
    }
  | { stage: 'text-search'; enabled: boolean; hits: TracedHit[]; ms: number }
  | { stage: 'fusion'; topK: number; hits: FusedHit[] }
  | { stage: 'prompt'; system: string; user: string }
  /** model null: nada relevante, o LLM não é chamado. */
  | { stage: 'generation'; model: string | null };
