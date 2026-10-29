# Arquitetura

Um RAG tem duas fases. A **ingestão** roda quando os documentos mudam: lê, quebra em pedaços, transforma cada pedaço num vetor e guarda. A **consulta** roda a cada pergunta: busca os pedaços mais relevantes e entrega só eles ao LLM.

## Visão geral

```mermaid
flowchart LR
  subgraph Ingestão
    direction LR
    F[(collections/&lt;nome&gt;)] --> L[Loader] --> C[Chunker] --> E1[Embedder] --> S[(VectorStore)]
  end
  subgraph Consulta
    direction LR
    Q[Pergunta] --> E2[Embedder] --> R[Retriever] --> P[Prompt] --> M[LLM] --> A[Resposta + fontes]
  end
  S -. busca .-> R
```

## Ingestão

O sync é incremental: cada documento tem um hash do conteúdo, e só o que mudou passa pelo embedder.

```mermaid
flowchart TD
  start([bun run rag ingest]) --> lock[Trava a coleção no modelo de embedding]
  lock --> load[Loader lê a pasta<br/>.md e .txt = 1 documento por arquivo<br/>.pdf = 1 documento por página]
  load --> hash{Hash igual ao<br/>que está no banco?}
  hash -- sim --> skip[Pula]
  hash -- não --> chunk[Chunker<br/>markdown: por seção, com o caminho de títulos<br/>pdf/txt: tamanho fixo com sobreposição]
  chunk --> empty{Gerou algum<br/>chunk?}
  empty -- não --> drop[Marca como vazio<br/>ex.: PDF escaneado sem OCR]
  empty -- sim --> embed[Embedder gera os vetores em lote]
  embed --> save[Transação: apaga os chunks antigos<br/>do documento e grava os novos]
  skip --> next{Mais documentos?}
  drop --> next
  save --> next
  next -- sim --> hash
  next -- não --> prune[Remove do banco o que sumiu da pasta]
```

## Consulta

A busca é híbrida. A vetorial acha trechos pelo significado, mesmo sem palavras em comum com a pergunta. A full-text acha termos exatos, como códigos de erro (`PAG-402`), em que a vetorial costuma falhar. As duas listas são fundidas com RRF.

```mermaid
sequenceDiagram
  autonumber
  participant U as Usuário
  participant R as Retriever
  participant E as Embedder (Gemini)
  participant DB as Postgres + pgvector
  participant L as LLM (Gemini)

  U->>R: pergunta
  R->>E: embedding da pergunta
  E-->>R: vetor de 768 números
  par busca vetorial
    R->>DB: cosseno via índice HNSW
    DB-->>R: 20 candidatos + similaridade
  and busca full-text
    R->>DB: tsvector @@ tsquery (portuguese)
    DB-->>R: 20 candidatos + ts_rank
  end
  R->>R: descarta similaridade < limiar<br/>funde as listas com RRF, fica com o top-k
  alt nenhum trecho relevante
    R-->>U: "Não encontrei" (o LLM nem é chamado)
  else achou trechos
    R->>L: prompt com trechos numerados [1], [2]...
    L-->>U: resposta em streaming, citando [n]
  end
```

### Por que RRF

O score da busca vetorial (cosseno, de 0 a 1) e o da full-text (`ts_rank`, sem teto) não estão na mesma escala, então somar os dois não faz sentido. O Reciprocal Rank Fusion usa só a **posição** de cada trecho em cada lista:

```
score(trecho) = Σ  1 / (60 + posição na lista)
```

Quem aparece bem colocado nas duas listas sobe.

## Camadas e interfaces

Cada caixa é uma interface de `src/core/types.ts`. O `src/rag.config.ts` escolhe as implementações; o resto do código só conhece as interfaces.

```mermaid
classDiagram
  direction LR
  class Loader {
    <<interface>>
    load() AsyncIterable~Document~
  }
  class Chunker {
    <<interface>>
    chunk(document) Chunk[]
  }
  class Embedder {
    <<interface>>
    model
    dimensions
    embedDocuments(texts) number[][]
    embedQuery(text) number[]
  }
  class VectorStore {
    <<interface>>
    ensureCollection(info)
    replaceDocument(collection, document, chunks)
    searchByVector(collection, embedding, options)
    searchByText(collection, query, options)
  }
  class Llm {
    <<interface>>
    stream(prompt) AsyncIterable~string~
  }

  Loader <|.. DirectoryLoader
  Chunker <|.. MarkdownChunker
  Chunker <|.. FixedSizeChunker
  Chunker <|.. MediaTypeChunker
  Embedder <|.. OllamaEmbedder
  VectorStore <|.. PgVectorStore
  VectorStore <|.. MemoryStore
  Llm <|.. GeminiLlm
  Llm <|.. OllamaLlm
```

## Modelo de dados

```mermaid
erDiagram
  collections ||--o{ documents : contém
  documents ||--o{ chunks : "quebrado em"

  collections {
    text name PK
    text embedding_model "trava: consultar com outro modelo dá erro"
    int dimensions
  }
  documents {
    text collection PK
    text id PK "caminho relativo, ou arquivo.pdf#page=N"
    text content_hash "sha256: decide se reindexa"
    jsonb metadata
  }
  chunks {
    text collection PK
    text id PK "documento:índice"
    text document_id FK
    text content
    jsonb metadata "source, title, page, section + frontmatter"
    vector embedding "vector(768), índice HNSW"
    tsvector content_tsv "gerada, índice GIN"
  }
```

## Decisões e por quês

| Decisão | Motivo |
|---|---|
| Postgres + pgvector, tabela única | Um banco só faz busca vetorial, full-text, filtro por `jsonb` e transação. A dimensão do vetor é fixa na coluna, então trocar de modelo de embedding exige recriar o banco. |
| PDF dividido por página | A citação aponta a página certa. |
| Prefixo com o caminho de títulos no chunk de markdown | Um trecho como "clique em Confirmar" sozinho perde o assunto, e o embedding fica genérico. |
| Limiar de similaridade antes da fusão | A busca vetorial sempre devolve *alguma coisa*. Sem limiar, uma pergunta fora do assunto recebe os trechos "menos distantes" e o LLM inventa. |
| Sem trecho relevante, não chama o LLM | Economiza chamada e elimina a chance de alucinação. |
| `hnsw.iterative_scan = strict_order` | O HNSW filtra depois de achar os vizinhos. Com várias coleções na mesma tabela, o filtro por coleção poderia sobrar com menos resultados que o pedido. |
