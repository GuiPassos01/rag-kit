import type { ChatPrompt, Document, Embedder, Llm, Loader } from '../src/core';

/**
 * Embedder determinístico de "saco de palavras": cada palavra cai numa dimensão
 * por hash. Textos com palavras em comum ficam próximos, o suficiente para testar
 * o pipeline sem um modelo de verdade.
 */
export class FakeEmbedder implements Embedder {
  readonly dimensions = 64;
  calls = 0;

  constructor(readonly model = 'fake-embedder') {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.calls++;
    return texts.map((text) => this.vectorize(text));
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.vectorize(text);
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const word of text.toLowerCase().match(/\p{L}{3,}/gu) ?? []) {
      const slot = Number(Bun.hash(word) % BigInt(this.dimensions));
      vector[slot] = (vector[slot] ?? 0) + 1;
    }
    return vector;
  }
}

export class FakeLlm implements Llm {
  readonly model = 'fake-llm';
  readonly prompts: ChatPrompt[] = [];
  readonly signals: Array<AbortSignal | undefined> = [];

  async *stream(prompt: ChatPrompt, signal?: AbortSignal): AsyncIterable<string> {
    this.prompts.push(prompt);
    this.signals.push(signal);
    yield 'Resposta ';
    yield 'falsa [1]';
  }
}

export function arrayLoader(documents: Document[]): Loader {
  return {
    async *load() {
      yield* documents;
    },
  };
}

export function markdownDoc(id: string, text: string): Document {
  return { id, text, mediaType: 'text/markdown', metadata: { source: id } };
}

export async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const token of stream) text += token;
  return text;
}
