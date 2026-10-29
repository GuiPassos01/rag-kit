import { ValidationError } from "../errors";
import type { RetrievedChunk } from "../types";

export interface EvalCase {
  question: string;
  expected: string[];
}

export interface EvalCaseResult {
  question: string;
  expected: string[];
  retrieved: string[];
  rank: number | null;
}

export interface EvalReport {
  k: number;
  hitRate: number;
  mrr: number;
  cases: EvalCaseResult[];
}

type Retrieve = (question: string) => Promise<RetrievedChunk[]>;

function invalidCase(index: number, reason: string): ValidationError {
  return new ValidationError(
    `Item ${index} do arquivo de avaliação: ${reason}`,
  );
}

function parseEvalCase(item: unknown, index: number): EvalCase {
  if (typeof item !== "object" || item === null)
    throw invalidCase(index, "precisa ser um objeto.");

  const { question, expected } = item as Record<string, unknown>;

  if (typeof question !== "string" || !question.trim())
    throw invalidCase(index, '"question" precisa ser um texto não vazio.');

  if (
    !Array.isArray(expected) ||
    expected.length === 0 ||
    !expected.every((id) => typeof id === "string")
  )
    throw invalidCase(
      index,
      '"expected" precisa ser uma lista não vazia de ids.',
    );

  return { question, expected };
}

export function parseEvalCases(input: unknown): EvalCase[] {
  if (!Array.isArray(input))
    throw new ValidationError("O arquivo de avaliação precisa ser uma lista.");
  return input.map(parseEvalCase);
}

function matchesExpected(documentId: string, expected: string): boolean {
  return documentId === expected || documentId.startsWith(`${expected}#`);
}

function uniqueDocumentIds(chunks: RetrievedChunk[]): string[] {
  return [...new Set(chunks.map((chunk) => chunk.documentId))];
}

function rankOfFirstMatch(
  documentIds: string[],
  expected: string[],
): number | null {
  const index = documentIds.findIndex((id) =>
    expected.some((target) => matchesExpected(id, target)),
  );
  return index === -1 ? null : index + 1;
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function evaluate(
  cases: EvalCase[],
  k: number,
  retrieve: Retrieve,
): Promise<EvalReport> {
  const results: EvalCaseResult[] = [];

  for (const { question, expected } of cases) {
    const retrieved = uniqueDocumentIds(await retrieve(question)).slice(0, k);
    results.push({
      question,
      expected,
      retrieved,
      rank: rankOfFirstMatch(retrieved, expected),
    });
  }

  return {
    k,
    hitRate: average(results.map(({ rank }) => (rank === null ? 0 : 1))),
    mrr: average(results.map(({ rank }) => (rank === null ? 0 : 1 / rank))),
    cases: results,
  };
}
