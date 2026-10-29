import { RagError } from "../core";

const STATUS_BY_CODE: Readonly<Record<RagError["code"], number>> = {
  VALIDATION_FAILED: 400,
  COLLECTION_NOT_FOUND: 404,
  EMBEDDING_MISMATCH: 409,
  PROVIDER_FAILED: 502,
  LOADER_FAILED: 500,
  CONFIG_INVALID: 500,
};

export function errorBody(error: unknown): { code: string; message: string } {
  if (error instanceof RagError)
    return { code: error.code, message: error.message };
  console.error("Erro inesperado:", error);
  return { code: "INTERNAL", message: "Erro interno." };
}

export function errorResponse(error: unknown): Response {
  const status = error instanceof RagError ? STATUS_BY_CODE[error.code] : 500;
  return Response.json({ error: errorBody(error) }, { status });
}
