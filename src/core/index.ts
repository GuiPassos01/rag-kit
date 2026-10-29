export * from "./types";
export * from "./errors";
export {
  DirectoryLoader,
  SUPPORTED_EXTENSIONS,
} from "./ingestion/loaders/directory-loader";
export { parseMarkdown, parsePlainText } from "./ingestion/loaders/markdown";
export { parsePdf } from "./ingestion/loaders/pdf";
export { splitText, type SplitOptions } from "./ingestion/chunkers/split-text";
export { FixedSizeChunker } from "./ingestion/chunkers/fixed-size-chunker";
export { MarkdownChunker } from "./ingestion/chunkers/markdown-chunker";
export { MediaTypeChunker } from "./ingestion/chunkers/media-type-chunker";
export {
  GeminiEmbedder,
  type GeminiEmbedderOptions,
} from "./shared/embedders/gemini-embedder";
export {
  OllamaEmbedder,
  type OllamaEmbedderOptions,
} from "./shared/embedders/ollama-embedder";
export { GeminiLlm, type GeminiLlmOptions } from "./query/llms/gemini-llm";
export { OllamaLlm, type OllamaLlmOptions } from "./query/llms/ollama-llm";
export { MemoryStore, cosineSimilarity } from "./shared/stores/memory-store";
export {
  PgVectorStore,
  type PgVectorStoreOptions,
} from "./shared/stores/pgvector-store";
export {
  ingest,
  hashContent,
  type IngestEvent,
  type IngestOptions,
  type IngestReport,
} from "./ingestion/ingest";
export { reciprocalRankFusion } from "./query/rrf";
export {
  Retriever,
  type RetrievalOptions,
  type RetrieveRequest,
} from "./query/retriever";
export {
  buildPrompt,
  excerpt,
  sourceLabel,
  toSources,
  type Source,
} from "./query/prompt";
export {
  evaluate,
  parseEvalCases,
  type EvalCase,
  type EvalReport,
} from "./query/evaluate";

export {
  createRag,
  MAX_QUESTION_LENGTH,
  NOT_FOUND_ANSWER,
  type Answer,
  type AskRequest,
  type Rag,
  type RagConfig,
} from "./rag";
