import { EmbeddingMismatchError, ProviderError } from "../../errors";
import type { Embedder } from "../../types";
import { post } from "../http";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiEmbedderOptions {
  apiKey: string;
  model: string;
  dimensions: number;
  batchSize?: number;
  timeoutMs?: number;
  retries?: number;
}

interface BatchEmbedResponse {
  embeddings?: Array<{ values?: number[] }>;
}

const QUERY_PREFIX = "task: search result | query: ";
const DOCUMENT_PREFIX = "title: none | text: ";

export class GeminiEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(private readonly options: GeminiEmbedderOptions) {
    this.model = options.model;
    this.dimensions = options.dimensions;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const batchSize = this.options.batchSize ?? 50;
    const embeddings: number[][] = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts
        .slice(start, start + batchSize)
        .map((text) => DOCUMENT_PREFIX + text);
      embeddings.push(...(await this.embed(batch)));
    }
    return embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embed([QUERY_PREFIX + text]);
    if (!embedding)
      throw new ProviderError(
        "gemini",
        "não devolveu o embedding da pergunta.",
      );
    return embedding;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const response = await post(
      `${BASE_URL}/${this.model}:batchEmbedContents`,
      {
        requests: texts.map((text) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: this.dimensions,
        })),
      },
      {
        provider: "gemini",
        headers: { "x-goog-api-key": this.options.apiKey },
        timeoutMs: this.options.timeoutMs ?? 60_000,
        retries: this.options.retries ?? 5,
      },
    );

    const embeddings = (
      (await response.json()) as BatchEmbedResponse
    ).embeddings?.map((embedding) => embedding.values ?? []);
    if (!embeddings || embeddings.length !== texts.length) {
      throw new ProviderError(
        "gemini",
        `devolveu ${embeddings?.length ?? 0} embeddings para ${texts.length} textos.`,
      );
    }
    const wrongSize = embeddings.find(
      (embedding) => embedding.length !== this.dimensions,
    );
    if (wrongSize) {
      throw new EmbeddingMismatchError(
        `O modelo "${this.model}" devolveu ${wrongSize.length} dimensões, mas EMBEDDING_DIMENSIONS=${this.dimensions}.`,
      );
    }
    return embeddings;
  }
}
