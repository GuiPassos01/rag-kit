import { afterEach, describe, expect, mock, test } from 'bun:test';

import { ProviderError } from '../src/core';
import { post } from '../src/core/shared/http';

const originalFetch = globalThis.fetch;

function mockResponses(...responses: Array<() => Response>): ReturnType<typeof mock> {
  let call = 0;
  const fetchMock = mock(async () => (responses[Math.min(call++, responses.length - 1)] ?? (() => new Response()))());
  globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });
  return fetchMock;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('post', () => {
  test('tenta de novo depois de um 429', async () => {
    const fetchMock = mockResponses(
      () => new Response('limite', { status: 429, headers: { 'retry-after': '0.01' } }),
      () => Response.json({ ok: true }),
    );
    const response = await post('https://api.exemplo.dev/x', {}, { provider: 'teste', timeoutMs: 1_000, retries: 2 });
    expect(await response.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('não repete erro do cliente e devolve o status', async () => {
    const fetchMock = mockResponses(() => new Response('chave inválida', { status: 400 }));
    const request = post('https://api.exemplo.dev/x', {}, { provider: 'teste', timeoutMs: 1_000, retries: 3 });
    expect(request).rejects.toMatchObject({ status: 400 });
    expect(request).rejects.toBeInstanceOf(ProviderError);
    await request.catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('não tenta de novo depois de cancelado', async () => {
    const controller = new AbortController();
    const fetchMock = mockResponses(() => {
      controller.abort();
      return new Response('limite', { status: 429, headers: { 'retry-after': '0.01' } });
    });
    const request = post('https://api.exemplo.dev/x', {}, {
      provider: 'teste',
      timeoutMs: 1_000,
      retries: 3,
      signal: controller.signal,
    });
    expect(request).rejects.toThrow('requisição cancelada.');
    await request.catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
