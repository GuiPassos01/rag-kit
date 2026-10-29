import {
  MAX_QUESTION_LENGTH,
  ValidationError,
  type Metadata,
  type MetadataValue,
} from "../core";

export interface QueryBody {
  question: string;
  topK?: number;
  filter?: Metadata;
}

const MAX_TOP_K = 20;

function isMetadataValue(value: unknown): value is MetadataValue {
  return (
    value === null || ["string", "number", "boolean"].includes(typeof value)
  );
}

function parseQuestion(raw: unknown): string {
  const question = typeof raw === "string" ? raw.trim() : "";
  if (!question) throw new ValidationError('"question" é obrigatório.');
  if (question.length > MAX_QUESTION_LENGTH)
    throw new ValidationError(
      `"question" passa de ${MAX_QUESTION_LENGTH} caracteres.`,
    );
  return question;
}

function parseTopK(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > MAX_TOP_K
  )
    throw new ValidationError(
      `"topK" precisa ser um inteiro entre 1 e ${MAX_TOP_K}.`,
    );
  return raw;
}

function parseFilter(raw: unknown): Metadata {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError('"filter" precisa ser um objeto chave/valor.');
  }
  const entries = Object.entries(raw);
  if (!entries.every(([, value]) => isMetadataValue(value))) {
    throw new ValidationError(
      'Os valores de "filter" precisam ser texto, número, booleano ou null.',
    );
  }
  return Object.fromEntries(entries);
}

export async function parseQueryBody(request: Request): Promise<QueryBody> {
  const body: unknown = await request.json().catch(() => {
    throw new ValidationError("Corpo precisa ser JSON válido.");
  });
  if (typeof body !== "object" || body === null)
    throw new ValidationError("Corpo precisa ser um objeto JSON.");

  const { question, topK, filter } = body as Record<string, unknown>;
  return {
    question: parseQuestion(question),
    ...(topK !== undefined && { topK: parseTopK(topK) }),
    ...(filter !== undefined && { filter: parseFilter(filter) }),
  };
}
