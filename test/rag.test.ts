import { describe, expect, test } from 'bun:test';

import {
  createRag,
  evaluate,
  MarkdownChunker,
  MemoryStore,
  NOT_FOUND_ANSWER,
  parseEvalCases,
  reciprocalRankFusion,
  ValidationError,
  type RetrievedChunk,
  type SearchHit,
  type TraceEvent,
} from '../src/core';
import { arrayLoader, collect, FakeEmbedder, FakeLlm, markdownDoc } from './fakes';

const hit = (id: string, score = 1): SearchHit => ({ id, documentId: id, text: id, metadata: {}, score });

describe('reciprocalRankFusion', () => {
  test('quem aparece nas duas listas sobe', () => {
    const fused = reciprocalRankFusion([
      [hit('a'), hit('b'), hit('c')],
      [hit('c'), hit('d')],
    ]);
    // c: 1/63 + 1/61 (3º e 1º lugar) vence a: 1/61 (só 1º lugar numa lista).
    expect(fused.map(({ hit }) => hit.id).slice(0, 2)).toEqual(['c', 'a']);
    expect(fused).toHaveLength(4);
  });
});

async function setupRag(minSimilarity = 0.3) {
  const llm = new FakeLlm();
  const rag = createRag({
    store: new MemoryStore(),
    embedder: new FakeEmbedder(),
    chunker: new MarkdownChunker({ size: 500, overlap: 50 }),
    llm,
    retrieval: { topK: 3, candidates: 10, minSimilarity, hybrid: true },
  });
  await rag.ingest({
    collection: 'ajuda',
    loader: arrayLoader([
      markdownDoc('cancelamento.md', '# Cancelamento\n\nPara cancelar a assinatura acesse configurações e plano.'),
      { ...markdownDoc('faturas.md', '# Faturas\n\nA fatura chega por email todo mês.'), metadata: { source: 'faturas.md', plano: 'pro' } },
    ]),
  });
  return { rag, llm };
}

describe('createRag', () => {
  test('responde com fontes e manda os trechos numerados para o LLM', async () => {
    const { rag, llm } = await setupRag();
    const answer = await rag.ask({ collection: 'ajuda', query: 'como cancelar a assinatura?' });

    expect(answer.found).toBe(true);
    expect(answer.sources[0]?.documentId).toBe('cancelamento.md');
    expect(await collect(answer.text)).toBe('Resposta falsa [1]');
    expect(llm.prompts[0]?.user).toContain('[1] (fonte: cancelamento.md · Cancelamento)');
    expect(llm.prompts[0]?.user).toContain('Pergunta: como cancelar a assinatura?');
  });

  test('repassa o signal de cancelamento para o LLM', async () => {
    const { rag, llm } = await setupRag();
    const controller = new AbortController();
    const answer = await rag.ask({ collection: 'ajuda', query: 'como cancelar a assinatura?', signal: controller.signal });
    await collect(answer.text);
    expect(llm.signals[0]).toBe(controller.signal);
  });

  test('sem trecho relevante, responde "não encontrei" sem chamar o LLM', async () => {
    const { rag, llm } = await setupRag();
    const answer = await rag.ask({ collection: 'ajuda', query: 'receita de bolo de cenoura' });

    expect(answer.found).toBe(false);
    expect(answer.sources).toEqual([]);
    expect(await collect(answer.text)).toBe(NOT_FOUND_ANSWER);
    expect(llm.prompts).toHaveLength(0);
  });

  test('filtro por metadado restringe a busca', async () => {
    const { rag } = await setupRag(0);
    const chunks = await rag.retrieve({ collection: 'ajuda', query: 'assinatura fatura', filter: { plano: 'pro' } });
    expect(chunks.map((chunk) => chunk.documentId)).toEqual(['faturas.md']);
  });

  test('trace mostra cada etapa com os dados reais', async () => {
    const { rag } = await setupRag();
    const events: TraceEvent[] = [];
    await rag.ask({ collection: 'ajuda', query: 'como cancelar a assinatura?', onTrace: (event) => events.push(event) });

    const stages = events.map((event) => event.stage);
    expect(stages[0]).toBe('embedding');
    expect(stages.slice(1, 3).sort()).toEqual(['text-search', 'vector-search']);
    expect(stages.slice(3)).toEqual(['fusion', 'prompt', 'generation']);

    const embedding = events.find((event) => event.stage === 'embedding');
    expect(embedding?.stage === 'embedding' && embedding.preview).toHaveLength(12);
    const fusion = events.find((event) => event.stage === 'fusion');
    expect(fusion?.stage === 'fusion' && fusion.hits[0]?.vectorRank).toBe(1);
    expect(events.at(-1)).toEqual({ stage: 'generation', model: 'fake-llm' });
  });

  test('trace sem trecho relevante não monta prompt e não chama o LLM', async () => {
    const { rag } = await setupRag();
    const events: TraceEvent[] = [];
    await rag.ask({ collection: 'ajuda', query: 'receita de bolo de cenoura', onTrace: (event) => events.push(event) });

    expect(events.map((event) => event.stage)).not.toContain('prompt');
    expect(events.at(-1)).toEqual({ stage: 'generation', model: null });
  });

  test('rejeita pergunta vazia', async () => {
    const { rag } = await setupRag();
    expect(rag.ask({ collection: 'ajuda', query: '   ' })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('evaluate', () => {
  const chunk = (documentId: string): RetrievedChunk => ({ ...hit(documentId), similarity: 1 });

  test('calcula hit rate e MRR, aceitando o arquivo inteiro de um PDF', async () => {
    const cases = parseEvalCases([
      { question: 'q1', expected: ['a.md'] },
      { question: 'q2', expected: ['manual.pdf'] },
      { question: 'q3', expected: ['z.md'] },
    ]);
    const results: Record<string, RetrievedChunk[]> = {
      q1: [chunk('a.md'), chunk('b.md')],
      q2: [chunk('b.md'), chunk('manual.pdf#page=4')],
      q3: [chunk('a.md')],
    };
    const report = await evaluate(cases, 5, async (question) => results[question] ?? []);

    expect(report.cases.map((result) => result.rank)).toEqual([1, 2, null]);
    expect(report.hitRate).toBeCloseTo(2 / 3);
    expect(report.mrr).toBeCloseTo((1 + 0.5) / 3);
  });

  test('rejeita arquivo de avaliação mal formado', () => {
    expect(() => parseEvalCases({ question: 'q' })).toThrow('precisa ser uma lista');
    expect(() => parseEvalCases(['texto'])).toThrow('Item 0 do arquivo de avaliação: precisa ser um objeto.');
    expect(() => parseEvalCases([{ question: 'sem expected' }])).toThrow(ValidationError);
    expect(() => parseEvalCases([{ question: 'q', expected: [1] }])).toThrow('"expected"');
    expect(() => parseEvalCases([{ question: '  ', expected: ['a.md'] }])).toThrow('"question"');
  });

  test('rejeita caso com expected vazio, que nunca acertaria', () => {
    expect(() => parseEvalCases([{ question: 'q1', expected: ['a.md'] }, { question: 'q2', expected: [] }])).toThrow(
      'Item 1 do arquivo de avaliação: "expected"',
    );
  });
});
