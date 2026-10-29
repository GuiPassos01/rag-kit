import { ValidationError } from "./errors";
import { buildPrompt, toSources, type Source } from "./query/prompt";
import {
  ingest,
  type IngestOptions,
  type IngestReport,
} from "./ingestion/ingest";
import {
  Retriever,
  type RetrievalOptions,
  type RetrieveRequest,
} from "./query/retriever";
import type {
  Chunker,
  Embedder,
  Llm,
  RetrievedChunk,
  VectorStore,
} from "./types";

export interface RagConfig {
  store: VectorStore;
  embedder: Embedder;
  chunker: Chunker;
  llm: Llm;
  retrieval: RetrievalOptions;
}

export interface Answer {
  sources: Source[];
  /** Vazio quando nada relevante foi encontrado: aí o LLM nem é chamado. */
  found: boolean;
  text: AsyncIterable<string>;
}

export interface AskRequest extends RetrieveRequest {
  /** Cancela a geração, ex.: quando o cliente da API desconecta. */
  signal?: AbortSignal;
}

export const NOT_FOUND_ANSWER =
  "Não encontrei informações sobre isso na base de conhecimento.";

export const MAX_QUESTION_LENGTH = 2_000;

async function* once(text: string): AsyncIterable<string> {
  yield text;
}

export interface Rag {
  ingest(options: IngestOptions): Promise<IngestReport>;
  /** Apaga a coleção do índice; os arquivos de origem não são tocados. */
  reset(collection: string): Promise<void>;
  retrieve(request: RetrieveRequest): Promise<RetrievedChunk[]>;
  ask(request: AskRequest): Promise<Answer>;
}

export function createRag(config: RagConfig): Rag {
  const retriever = new Retriever(
    config.store,
    config.embedder,
    config.retrieval,
  );

  return {
    ingest: (options) => ingest(config, options),

    reset: (collection) => config.store.deleteCollection(collection),

    retrieve: (request) => retriever.retrieve(request),

    async ask(request) {
      const question = request.query.trim();
      if (!question)
        throw new ValidationError("A pergunta não pode ser vazia.");
      if (question.length > MAX_QUESTION_LENGTH) {
        throw new ValidationError(
          `A pergunta passa de ${MAX_QUESTION_LENGTH} caracteres.`,
        );
      }

      const chunks = await retriever.retrieve({ ...request, query: question });
      if (chunks.length === 0) {
        request.onTrace?.({ stage: "generation", model: null });
        return { sources: [], found: false, text: once(NOT_FOUND_ANSWER) };
      }

      const prompt = buildPrompt(question, chunks);
      request.onTrace?.({ stage: "prompt", ...prompt });
      request.onTrace?.({ stage: "generation", model: config.llm.model });
      return {
        sources: toSources(chunks),
        found: true,
        text: config.llm.stream(prompt, request.signal),
      };
    },
  };
}
