import { SQL } from 'bun';

import { ConfigError, CollectionNotFoundError, EmbeddingMismatchError } from '../../errors';
import type {
  CollectionInfo,
  EmbeddedChunk,
  Metadata,
  SearchHit,
  SearchOptions,
  StoredDocument,
  VectorStore,
} from '../../types';

export interface PgVectorStoreOptions {
  url: string;
  dimensions: number;
  /** Configuração de full-text do Postgres (stemming e stopwords), ex.: `portuguese`. */
  textSearchConfig: string;
}

interface HitRow {
  id: string;
  document_id: string;
  content: string;
  metadata: Metadata;
  score: number;
}

interface CollectionRow {
  embedding_model: string;
  dimensions: number;
}

function schema(dimensions: number, textSearchConfig: string): string {
  return `
    create extension if not exists vector;

    create table if not exists collections (
      name text primary key,
      embedding_model text not null,
      dimensions integer not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists documents (
      collection text not null references collections (name) on delete cascade,
      id text not null,
      content_hash text not null,
      metadata jsonb not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (collection, id)
    );

    create table if not exists chunks (
      id text not null,
      collection text not null,
      document_id text not null,
      chunk_index integer not null,
      content text not null,
      metadata jsonb not null default '{}',
      embedding vector(${dimensions}) not null,
      content_tsv tsvector generated always as (to_tsvector('${textSearchConfig}', content)) stored,
      created_at timestamptz not null default now(),
      primary key (collection, id),
      foreign key (collection, document_id) references documents (collection, id) on delete cascade
    );

    create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
    create index if not exists chunks_content_tsv_idx on chunks using gin (content_tsv);
    create index if not exists chunks_metadata_idx on chunks using gin (metadata jsonb_path_ops);
    create index if not exists chunks_document_idx on chunks (collection, document_id);
  `;
}

// Serializado à mão e passado como ::text: com só ::jsonb, o Bun.sql serializa a string de novo e grava um jsonb do tipo string.
const toJson = (metadata: Metadata): string => JSON.stringify(metadata);

const toVector = (embedding: number[]): string => `[${embedding.join(',')}]`;

/** Termos unidos por "or": por padrão o websearch_to_tsquery exige todas as palavras. */
function toOrQuery(query: string): string {
  return (query.match(/[\p{L}\p{N}]+/gu) ?? []).join(' or ');
}

function toHit(row: HitRow): SearchHit {
  return {
    id: row.id,
    documentId: row.document_id,
    text: row.content,
    metadata: row.metadata,
    score: Number(row.score),
  };
}

export class PgVectorStore implements VectorStore {
  private constructor(
    private readonly sql: SQL,
    private readonly options: PgVectorStoreOptions,
  ) {}

  static async connect(options: PgVectorStoreOptions): Promise<PgVectorStore> {
    if (!Number.isInteger(options.dimensions) || options.dimensions < 1 || options.dimensions > 16_000) {
      throw new ConfigError(`Dimensão inválida: ${options.dimensions}.`);
    }
    if (!/^[a-z_]+$/.test(options.textSearchConfig)) {
      throw new ConfigError(`Configuração de full-text inválida: "${options.textSearchConfig}".`);
    }
    // O HNSW filtra depois de achar os vizinhos: com várias coleções, o filtro por
    // coleção poderia sobrar com menos de `limit` resultados. A busca iterativa
    // (pgvector >= 0.8) continua varrendo até completar. Vai na abertura de cada
    // conexão para não custar uma transação extra por busca.
    const sql = new SQL(options.url, { connection: { 'hnsw.iterative_scan': 'strict_order' } });
    const store = new PgVectorStore(sql, options);
    await store.migrate();
    return store;
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  async ensureCollection(info: CollectionInfo): Promise<void> {
    await this.sql`
      insert into collections (name, embedding_model, dimensions)
      values (${info.name}, ${info.embeddingModel}, ${info.dimensions})
      on conflict (name) do nothing
    `;
    const existing = await this.getCollection(info.name);
    if (existing.embedding_model !== info.embeddingModel) {
      throw new EmbeddingMismatchError(
        `A coleção "${info.name}" foi indexada com "${existing.embedding_model}", não com "${info.embeddingModel}". Reindexe com --reset.`,
      );
    }
  }

  async deleteCollection(name: string): Promise<void> {
    await this.sql`delete from collections where name = ${name}`;
  }

  async getDocumentHashes(collection: string): Promise<Map<string, string>> {
    const rows: Array<{ id: string; content_hash: string }> = await this.sql`
      select id, content_hash from documents where collection = ${collection}
    `;
    return new Map(rows.map((row) => [row.id, row.content_hash]));
  }

  async replaceDocument(
    collection: string,
    document: StoredDocument,
    chunks: EmbeddedChunk[],
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`
        insert into documents (collection, id, content_hash, metadata)
        values (${collection}, ${document.id}, ${document.contentHash}, ${toJson(document.metadata)}::text::jsonb)
        on conflict (collection, id) do update
          set content_hash = excluded.content_hash, metadata = excluded.metadata, updated_at = now()
      `;
      await tx`delete from chunks where collection = ${collection} and document_id = ${document.id}`;
      if (chunks.length === 0) return;
      // Um insert só para o documento inteiro: cada coluna vai como array e o unnest monta as linhas.
      await tx`
        insert into chunks (id, collection, document_id, chunk_index, content, metadata, embedding)
        select row.id, ${collection}, ${document.id}, row.chunk_index, row.content, row.metadata::jsonb, row.embedding::vector
        from unnest(
          ${this.sql.array(chunks.map((chunk) => `${document.id}:${chunk.index}`), 'TEXT')}::text[],
          ${this.sql.array(chunks.map((chunk) => chunk.index), 'INT')}::int[],
          ${this.sql.array(chunks.map((chunk) => chunk.text), 'TEXT')}::text[],
          ${this.sql.array(chunks.map((chunk) => toJson(chunk.metadata)), 'TEXT')}::text[],
          ${this.sql.array(chunks.map((chunk) => toVector(chunk.embedding)), 'TEXT')}::text[]
        ) as row (id, chunk_index, content, metadata, embedding)
      `;
    });
  }

  async deleteDocuments(collection: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.sql`
      delete from documents where collection = ${collection} and id = any(${this.sql.array([...ids], 'TEXT')})
    `;
  }

  async searchByVector(
    collection: string,
    embedding: number[],
    { limit, filter }: SearchOptions,
  ): Promise<SearchHit[]> {
    const vector = toVector(embedding);
    const rows: HitRow[] = await this.sql`
      select id, document_id, content, metadata, 1 - (embedding <=> ${vector}::vector) as score
      from chunks
      where collection = ${collection} and metadata @> ${toJson(filter ?? {})}::text::jsonb
      order by embedding <=> ${vector}::vector
      limit ${limit}
    `;
    return rows.map(toHit);
  }

  async searchByText(collection: string, query: string, { limit, filter }: SearchOptions): Promise<SearchHit[]> {
    const orQuery = toOrQuery(query);
    if (!orQuery) return [];
    const rows: HitRow[] = await this.sql`
      select id, document_id, content, metadata, ts_rank_cd(content_tsv, query) as score
      from chunks, websearch_to_tsquery(${this.options.textSearchConfig}::regconfig, ${orQuery}) as query
      where collection = ${collection} and content_tsv @@ query and metadata @> ${toJson(filter ?? {})}::text::jsonb
      order by score desc
      limit ${limit}
    `;
    return rows.map(toHit);
  }

  private async getCollection(name: string): Promise<CollectionRow> {
    const [row]: CollectionRow[] = await this.sql`
      select embedding_model, dimensions from collections where name = ${name}
    `;
    if (!row) throw new CollectionNotFoundError(name);
    return row;
  }

  private async migrate(): Promise<void> {
    const { dimensions, textSearchConfig } = this.options;
    await this.sql.unsafe(schema(dimensions, textSearchConfig)).simple();

    // A tabela é criada uma vez só: se o .env mudou depois, avisa em vez de gravar errado.
    const [column]: Array<{ dimensions: number; expression: string }> = await this.sql`
      select a.atttypmod as dimensions, pg_get_expr(d.adbin, d.adrelid) as expression
      from pg_attribute a
      join pg_attrdef d on d.adrelid = a.attrelid
      join pg_attribute t on t.attrelid = d.adrelid and t.attnum = d.adnum and t.attname = 'content_tsv'
      where a.attrelid = 'chunks'::regclass and a.attname = 'embedding'
    `;
    if (column && column.dimensions !== dimensions) {
      throw new ConfigError(
        `A tabela chunks guarda vetores de ${column.dimensions} dimensões, mas EMBEDDING_DIMENSIONS=${dimensions}. Recrie o banco (bun run db:reset) para trocar de modelo.`,
      );
    }
    if (column && !column.expression.includes(`'${textSearchConfig}'`)) {
      throw new ConfigError(
        `A coluna de full-text foi criada com outra configuração (${column.expression}), mas FTS_LANGUAGE=${textSearchConfig}.`,
      );
    }
  }
}
