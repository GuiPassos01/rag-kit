import { ConfigError } from './core';

function read(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (value === undefined) throw new ConfigError(`Variável de ambiente ${name} é obrigatória (veja o .env.example).`);
  return value;
}

function readNumber(name: string, fallback: number): number {
  const value = Number(read(name, String(fallback)));
  if (!Number.isFinite(value)) throw new ConfigError(`${name} precisa ser um número.`);
  return value;
}

function readChoice<const TChoice extends string>(name: string, choices: readonly TChoice[], fallback: TChoice): TChoice {
  const value = read(name, fallback);
  const choice = choices.find((option) => option === value);
  if (!choice) throw new ConfigError(`${name} precisa ser um destes: ${choices.join(', ')}.`);
  return choice;
}

export function loadEnv() {
  const providers = ['gemini', 'ollama'] as const;
  const embeddingProvider = readChoice('EMBEDDING_PROVIDER', providers, 'gemini');
  const llmProvider = readChoice('LLM_PROVIDER', providers, 'gemini');
  const usesGemini = embeddingProvider === 'gemini' || llmProvider === 'gemini';
  return {
    databaseUrl: read('DATABASE_URL'),
    geminiApiKey: usesGemini ? read('GEMINI_API_KEY') : '',
    ollamaUrl: read('OLLAMA_URL', 'http://localhost:11434'),
    embeddingProvider,
    embeddingModel: read('EMBEDDING_MODEL', embeddingProvider === 'gemini' ? 'gemini-embedding-2' : 'nomic-embed-text'),
    embeddingDimensions: readNumber('EMBEDDING_DIMENSIONS', 768),
    llmProvider,
    llmModel: read('LLM_MODEL', llmProvider === 'gemini' ? 'gemini-3.5-flash-lite' : 'llama3.2'),
    topK: readNumber('RAG_TOP_K', 5),
    candidates: readNumber('RAG_CANDIDATES', 20),
    minSimilarity: readNumber('RAG_MIN_SIMILARITY', 0.4),
    hybrid: read('RAG_HYBRID', 'true') === 'true',
    chunkSize: readNumber('CHUNK_SIZE', 1_200),
    chunkOverlap: readNumber('CHUNK_OVERLAP', 200),
    textSearchConfig: read('FTS_LANGUAGE', 'portuguese'),
    collectionsDir: read('COLLECTIONS_DIR', 'collections'),
    apiPort: readNumber('API_PORT', 3000),
  } as const;
}

export type Env = ReturnType<typeof loadEnv>;

