/**
 * O "plug" do projeto: aqui se escolhe cada peça do pipeline.
 * Para trocar de provedor ou de banco, troque a implementação aqui;
 * o resto do código só conhece as interfaces de core/types.ts.
 */
import { resolve } from 'node:path';
import {
  createRag,
  FixedSizeChunker,
  GeminiEmbedder,
  GeminiLlm,
  MarkdownChunker,
  MediaTypeChunker,
  OllamaEmbedder,
  OllamaLlm,
  PgVectorStore,
  type Embedder,
  type Llm,
  type Rag,
} from './core';

import { loadEnv, type Env } from './env';

// Prefixos de tarefa com que o nomic-embed-text foi treinado.
const NOMIC_PREFIXES = { queryPrefix: 'search_query: ', documentPrefix: 'search_document: ' };

function createEmbedder(env: Env): Embedder {
  const { embeddingModel: model, embeddingDimensions: dimensions } = env;
  if (env.embeddingProvider === 'gemini') return new GeminiEmbedder({ apiKey: env.geminiApiKey, model, dimensions });
  return new OllamaEmbedder({
    baseUrl: env.ollamaUrl,
    model,
    dimensions,
    ...(model.startsWith('nomic-embed') && NOMIC_PREFIXES),
  });
}

function createLlm(env: Env): Llm {
  if (env.llmProvider === 'ollama') return new OllamaLlm({ baseUrl: env.ollamaUrl, model: env.llmModel });
  return new GeminiLlm({ apiKey: env.geminiApiKey, model: env.llmModel });
}

export interface App {
  rag: Rag;
  collectionsDir: string;
  close(): Promise<void>;
}

export async function createApp(): Promise<App> {
  const env = loadEnv();
  const store = await PgVectorStore.connect({
    url: env.databaseUrl,
    dimensions: env.embeddingDimensions,
    textSearchConfig: env.textSearchConfig,
  });

  const split = { size: env.chunkSize, overlap: env.chunkOverlap };
  const rag = createRag({
    store,
    embedder: createEmbedder(env),
    chunker: new MediaTypeChunker({ 'text/markdown': new MarkdownChunker(split) }, new FixedSizeChunker(split)),
    llm: createLlm(env),
    retrieval: {
      topK: env.topK,
      candidates: env.candidates,
      minSimilarity: env.minSimilarity,
      hybrid: env.hybrid,
    },
  });

  return { rag, collectionsDir: resolve(env.collectionsDir), close: () => store.close() };
}
