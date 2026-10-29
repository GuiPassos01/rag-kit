import { ProviderError } from "../../errors";
import type { ChatPrompt, Llm } from "../../types";
import { post, readSseData } from "../../shared/http";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const BLOCKED_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
]);

export interface GeminiLlmOptions {
  apiKey: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

interface StreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
}

export class GeminiLlm implements Llm {
  readonly model: string;

  constructor(private readonly options: GeminiLlmOptions) {
    this.model = options.model;
  }

  async *stream({ system, user }: ChatPrompt, signal?: AbortSignal): AsyncIterable<string> {
    const response = await post(
      `${BASE_URL}/${this.model}:streamGenerateContent?alt=sse`,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: this.options.temperature ?? 0.2 },
      },
      {
        provider: "gemini",
        headers: { "x-goog-api-key": this.options.apiKey },
        timeoutMs: this.options.timeoutMs ?? 90_000,
        retries: 3,
        ...(signal && { signal }),
      },
    );

    for await (const data of readSseData(response)) {
      const candidate = (JSON.parse(data) as StreamChunk).candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) yield part.text;
      }
      if (
        candidate?.finishReason &&
        BLOCKED_FINISH_REASONS.has(candidate.finishReason)
      ) {
        throw new ProviderError(
          "gemini",
          `resposta interrompida (finishReason: ${candidate.finishReason}).`,
        );
      }
    }
  }
}
