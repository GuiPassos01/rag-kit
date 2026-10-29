import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CollectionNotFoundError, ValidationError } from './core';

// Só nomes simples: o nome vira caminho de pasta, então nada de "../".
const COLLECTION_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function assertCollectionName(name: string): void {
  if (!COLLECTION_NAME.test(name)) {
    throw new ValidationError(`Nome de coleção inválido: "${name}". Use letras minúsculas, números, "-" ou "_".`);
  }
}

export async function listCollections(collectionsDir: string): Promise<string[]> {
  const entries = await readdir(collectionsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && COLLECTION_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function collectionPath(collectionsDir: string, name: string): Promise<string> {
  assertCollectionName(name);
  if (!(await listCollections(collectionsDir)).includes(name)) throw new CollectionNotFoundError(name);
  return join(collectionsDir, name);
}
