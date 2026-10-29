import { ProviderError } from "../../errors";
import type { ChatPrompt, Llm } from "../../types";
import { post, readLines } from "../../shared/http";

export interface OllamaLlmOptions {
  baseUrl: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

interface ChatChunk {
  message?: { content?: string };
  error?: string;
}

export class OllamaLlm implements Llm {
  readonly model: string;

  constructor(private readonly options: OllamaLlmOptions) {
    this.model = options.model;
  }

  async *stream({ system, user }: ChatPrompt, signal?: AbortSignal): AsyncIterable<string> {
    const response = await post(
      `${this.options.baseUrl}/api/chat`,
      {
        model: this.model,
        stream: true,
        options: { temperature: this.options.temperature ?? 0.2 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      // Rodando em CPU, a primeira resposta inclui carregar o modelo na memória.
      {
        provider: "ollama",
        timeoutMs: this.options.timeoutMs ?? 300_000,
        ...(signal && { signal }),
      },
    );

    for await (const line of readLines(response)) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line) as ChatChunk;
      if (chunk.error) throw new ProviderError("ollama", chunk.error);
      if (chunk.message?.content) yield chunk.message.content;
    }
  }
}
