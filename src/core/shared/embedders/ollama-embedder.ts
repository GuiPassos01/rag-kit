import { EmbeddingMismatchError, ProviderError } from '../../errors';
import type { Embedder } from '../../types';
import { post } from '../http';

export interface OllamaEmbedderOptions {
  baseUrl: string;
  model: string;
  dimensions: number;
  /**
   * Alguns modelos foram treinados com prefixos de tarefa e perdem qualidade sem
   * eles. O nomic-embed-text, por exemplo, espera "search_query: " e "search_document: ".
   */
  queryPrefix?: string;
  documentPrefix?: string;
  batchSize?: number;
  timeoutMs?: number;
}

interface EmbedResponse {
  embeddings?: number[][];
}

export class OllamaEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(private readonly options: OllamaEmbedderOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const prefix = this.options.documentPrefix ?? '';
    const batchSize = this.options.batchSize ?? 32;
    const embeddings: number[][] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize).map((text) => prefix + text);
      embeddings.push(...(await this.embed(batch)));
    }
    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embed([(this.options.queryPrefix ?? '') + text]);
    if (!embedding) throw new ProviderError('ollama', 'não devolveu o embedding da pergunta.');
    return embedding;
  }

  private async embed(input: string[]): Promise<number[][]> {
    const response = await post(
      `${this.options.baseUrl}/api/embed`,
      { model: this.model, input },
      { provider: 'ollama', timeoutMs: this.options.timeoutMs ?? 120_000 },
    );
    const { embeddings } = (await response.json()) as EmbedResponse;
    if (!embeddings || embeddings.length !== input.length) {
      throw new ProviderError('ollama', `devolveu ${embeddings?.length ?? 0} embeddings para ${input.length} textos.`);
    }
    const wrongSize = embeddings.find((embedding) => embedding.length !== this.dimensions);
    if (wrongSize) {
      throw new EmbeddingMismatchError(
        `O modelo "${this.model}" gera vetores de ${wrongSize.length} dimensões, mas EMBEDDING_DIMENSIONS=${this.dimensions}.`,
      );
    }
    return embeddings;
  }
}
