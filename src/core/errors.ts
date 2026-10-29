export type RagErrorCode =
  | "CONFIG_INVALID"
  | "VALIDATION_FAILED"
  | "PROVIDER_FAILED"
  | "EMBEDDING_MISMATCH"
  | "LOADER_FAILED"
  | "COLLECTION_NOT_FOUND";

export class RagError extends Error {
  constructor(
    readonly code: RagErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConfigError extends RagError {
  constructor(message: string) {
    super("CONFIG_INVALID", message);
  }
}

export class ValidationError extends RagError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
  }
}

export class ProviderError extends RagError {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super("PROVIDER_FAILED", `[${provider}] ${message}`, options);
  }
}

export class EmbeddingMismatchError extends RagError {
  constructor(message: string) {
    super("EMBEDDING_MISMATCH", message);
  }
}

export class LoaderError extends RagError {
  constructor(message: string, options?: ErrorOptions) {
    super("LOADER_FAILED", message, options);
  }
}

export class CollectionNotFoundError extends RagError {
  constructor(name: string) {
    super("COLLECTION_NOT_FOUND", `Coleção "${name}" não encontrada.`);
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
