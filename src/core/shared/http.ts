import { describeError, ProviderError } from '../errors';

export interface PostOptions {
  provider: string;
  headers?: Readonly<Record<string, string>>;
  timeoutMs: number;
  /** Novas tentativas em 429 (limite do plano) e 5xx (sobrecarga), com espera crescente. */
  retries?: number;
  signal?: AbortSignal;
}

// 429 = limite de requisições do plano; 5xx = sobrecarga ou instabilidade do provedor.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 30_000;

function backoffMs(attempt: number, response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

export async function post(url: string, body: unknown, options: PostOptions): Promise<Response> {
  const retries = options.retries ?? 0;
  for (let attempt = 0; ; attempt++) {
    const response = await send(url, body, options);
    if (response.ok) return response;
    if (attempt >= retries || !RETRYABLE_STATUSES.has(response.status)) {
      throw new ProviderError(
        options.provider,
        `respondeu ${response.status}: ${await response.text()}`,
        response.status,
      );
    }
    await response.body?.cancel();
    await Bun.sleep(backoffMs(attempt, response));
    if (options.signal?.aborted) throw cancelled(options.provider, options.signal);
  }
}

function cancelled(provider: string, signal: AbortSignal): ProviderError {
  return new ProviderError(provider, 'requisição cancelada.', undefined, { cause: signal.reason });
}

async function send(url: string, body: unknown, options: PostOptions): Promise<Response> {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body: JSON.stringify(body),
      signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
    });
  } catch (error) {
    if (options.signal?.aborted) throw cancelled(options.provider, options.signal);
    throw new ProviderError(
      options.provider,
      `falha de rede ou timeout em ${new URL(url).origin}: ${describeError(error)}`,
      undefined,
      { cause: error },
    );
  }
}

export async function* readLines(response: Response): AsyncIterable<string> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    yield* lines;
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

/** Extrai o payload de cada evento `data:` de um stream SSE. */
export async function* readSseData(response: Response): AsyncIterable<string> {
  for await (const line of readLines(response)) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('data:')) yield trimmed.slice(5).trimStart();
  }
}
