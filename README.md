# rag-kit

RAG (Retrieval-Augmented Generation) plug and play em TypeScript, feito para estudar cada camada do pipeline. Você coloca arquivos `.md`, `.txt` ou `.pdf` numa pasta, indexa e faz perguntas: a resposta vem citando de qual documento (e página) saiu cada informação.

- **Busca híbrida**: vetorial (significado) + full-text (termos exatos), fundidas com RRF
- **Sync incremental**: reindexa só o que mudou, remove o que sumiu da pasta
- **Citações**: cada resposta traz as fontes numeradas, com arquivo, página e seção
- **"Não sei" de verdade**: sem trecho relevante, responde que não encontrou e nem chama o LLM
- **Avaliação**: `rag eval` mede hit rate@k e MRR para você comparar configurações
- **Peças trocáveis**: loader, chunker, embedder, banco e LLM são interfaces

A explicação de cada camada, com diagramas, está em [docs/arquitetura.md](docs/arquitetura.md).

## Stack

| Peça | Padrão | Por quê |
|---|---|---|
| Runtime | [Bun](https://bun.sh) | Roda TS direto, `bun test` e cliente Postgres embutidos |
| Banco | Postgres 17 + [pgvector](https://github.com/pgvector/pgvector) | Vetor, full-text e filtros num lugar só |
| Embeddings | Gemini (`gemini-embedding-2`, 768 dimensões) ou Ollama | Só precisa da chave; Ollama (`nomic-embed-text`) para não mandar os textos para fora |
| LLM | Gemini (`gemini-3.5-flash-lite`) ou Ollama | Plano gratuito do Gemini; Ollama para rodar tudo local |
| PDF | [unpdf](https://github.com/unjs/unpdf) | Extrai texto página a página, sem dependência nativa |

## Como rodar

Pré-requisitos: Bun 1.3+, Docker e uma chave do Gemini (gratuita).

```bash
bun install
cp .env.example .env          # preencha GEMINI_API_KEY (https://aistudio.google.com/apikey)
bun run db:up                 # Postgres + pgvector na porta 5434

bun run rag ingest central-de-ajuda
bun run rag ask central-de-ajuda "Como cancelo minha assinatura?"
```

Saída (ilustrativa: o texto e os números variam conforme o modelo):

```
Para cancelar, entre em Configurações > Plano e cobrança e clique em Encerrar
assinatura [1]. O acesso continua até o fim do ciclo já pago [2]...

Fontes:
  [1] cancelamento-de-assinatura.md · Cancelamento de assinatura > Como cancelar (similaridade 0.712)
  [2] cancelamento-de-assinatura.md · Cancelamento de assinatura > O que acontece depois (similaridade 0.655)
```

### Interface

```bash
bun run api                   # abra http://localhost:3000
```

Uma página só (`public/index.html`, sem build) que mostra o pipeline funcionando: cada pergunta percorre o diagrama, e clicando numa etapa você vê o que passou por ela. Isso inclui o vetor da pergunta, os candidatos de cada busca com o limiar, a fusão RRF, o prompt montado e a resposta com as citações. O botão **Reindexar** mostra a ingestão: cada arquivo passa pelo loader, pelo hash, pelo chunker e pelo embedder até chegar ao banco.

Os dados são os reais, vindos do evento `trace` da API. Só o ritmo da animação é desacelerado para dar tempo de ler; desmarque "animação em ritmo de leitura" para ver na velocidade de verdade.

### Seus próprios documentos

Cada subpasta de `collections/` é uma coleção. Crie uma pasta, coloque os arquivos e indexe:

```bash
mkdir collections/meus-pdfs        # copie seus .pdf / .md / .txt para cá
bun run rag ingest meus-pdfs
bun run rag ask meus-pdfs "sua pergunta"
```

Só a coleção de exemplo vai para o git; o resto de `collections/` é ignorado.

Em `.md`, o frontmatter vira metadado filtrável:

```markdown
---
plano: pro
---
# Integração com Google Agenda
```

## CLI

```bash
bun run rag ingest [coleção] [--reset] [--no-prune]
bun run rag ask <coleção> "pergunta" [--top-k 5]
bun run rag eval <coleção> [--file evaluations/<coleção>.json] [--k 5]
```

- `ingest` sem nome indexa todas as coleções. `--reset` apaga o índice da coleção antes. Por padrão, documentos que sumiram da pasta saem do índice; `--no-prune` desliga isso.
- `eval` roda as perguntas do arquivo de avaliação e mostra em que posição o documento esperado apareceu.

## API

```bash
bun run api
```

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/health` | Status |
| `GET` | `/collections` | Lista as pastas de `collections/` |
| `GET` | `/` | A interface |
| `POST` | `/collections/:nome/ingestions` | Reindexa `collections/:nome`. Com `Accept: text/event-stream`, emite `progress` a cada documento e `done` com o relatório |
| `POST` | `/collections/:nome/queries` | Pergunta. Corpo: `{ "question": "...", "topK"?: 5, "filter"?: { "plano": "pro" } }` |

A consulta responde em **SSE** ou em JSON com `Accept: application/json`. No SSE, os eventos são `trace` (uma vez por etapa, com os dados dela), `sources`, `token`, `done` e `error`:

```bash
curl -N -X POST localhost:3000/collections/central-de-ajuda/queries \
  -H 'Content-Type: application/json' \
  -d '{"question": "O que é o erro PAG-402?"}'
```

## MCP

`bun run mcp` sobe um servidor [MCP](https://modelcontextprotocol.io) via stdio, para usar o rag-kit de dentro do Claude Code, Claude Desktop, Cursor etc. Tools:

| Tool | O que faz |
|---|---|
| `list_collections` | Lista as coleções |
| `search` | Busca híbrida e devolve os trechos com a fonte, sem passar pelo LLM. O LLM do cliente responde a partir deles |
| `ask` | Pipeline completo: busca e gera a resposta com o LLM do `.env` |

`search` e `ask` recebem `collection`, `question` e, opcionalmente, `topK` e `filter`. A ingestão continua pela CLI ou pela API. O `.env` e a pasta `collections/` são lidos do diretório de trabalho, por isso o `--cwd`:

```bash
claude mcp add rag-kit -- bun --cwd /caminho/do/rag-kit src/mcp/server.ts
```

No Claude Desktop/Cursor, o equivalente em JSON:

```json
{ "mcpServers": { "rag-kit": { "command": "bun", "args": ["--cwd", "/caminho/do/rag-kit", "src/mcp/server.ts"] } } }
```

## Avaliação

`evaluations/<coleção>.json` lista perguntas e o documento que deveria ser encontrado:

```json
[{ "question": "O que significa o erro PAG-402?", "expected": ["pagamentos-e-faturas.md"] }]
```

Para PDF, `manual.pdf` aceita qualquer página e `manual.pdf#page=3` só aquela.

```bash
bun run rag eval central-de-ajuda
```

Formato da saída (números ilustrativos):

```
#1     Como faço para encerrar meu plano?
#2     Tem desconto se eu pagar o ano inteiro?
ERROU  Apareceu SYNC-110 no calendário
       esperado: integracao-google-agenda.md | veio: planos-e-precos.md

hit rate@5: 92.9%   MRR: 0.845   (14 perguntas)
```

- **Hit rate@k**: em quantas perguntas o documento certo apareceu entre os k primeiros.
- **MRR**: média de 1/posição do primeiro acerto. Achar em 1º vale 1, em 2º vale 0,5.

Rode antes e depois de mudar `CHUNK_SIZE`, `RAG_MIN_SIMILARITY` ou `RAG_HYBRID` para ver o efeito de verdade.

## Configuração

Tudo pelo `.env` (veja [.env.example](.env.example)). As mais importantes:

| Variável | Padrão | Efeito |
|---|---|---|
| `EMBEDDING_PROVIDER` | `gemini` | `gemini` ou `ollama` |
| `LLM_PROVIDER` | `gemini` | `gemini` ou `ollama` |
| `LLM_MODEL` | `gemini-3.5-flash-lite` | Modelo que escreve a resposta |
| `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` | `gemini-embedding-2` / `768` | Trocar qualquer um exige `bun run db:reset` |
| `RAG_TOP_K` | `5` | Quantos trechos vão para o LLM |
| `RAG_MIN_SIMILARITY` | `0.4` | Abaixo disso, o trecho é descartado. Depende do modelo de embedding |
| `RAG_HYBRID` | `true` | Liga a busca full-text junto com a vetorial |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `1200` / `200` | Em caracteres (~4 por token em português) |

### Trocar uma peça

O `src/rag.config.ts` é o único lugar que conhece as implementações. Para outro provedor, implemente a interface (`Embedder`, `Llm`, `VectorStore`...) de `src/core/types.ts` e troque a linha correspondente. A `MemoryStore` e o `FakeEmbedder` dos testes são exemplos pequenos.

### Rodar tudo local com Ollama

Sem mandar nada para fora (e sem cota), ao custo de RAM e velocidade:

```bash
ollama pull nomic-embed-text && ollama pull llama3.2
```

No `.env`: `EMBEDDING_PROVIDER=ollama`, `EMBEDDING_MODEL=nomic-embed-text`, `LLM_PROVIDER=ollama`, `LLM_MODEL=llama3.2`. Como o modelo de embedding muda, rode `bun run db:reset` e indexe de novo.

### Limite do plano gratuito

O plano gratuito do Gemini limita requisições por minuto. As chamadas tentam de novo sozinhas em 429 e 5xx, com espera crescente; ingerir muitos PDFs de uma vez pode demorar por isso. Como o sync é incremental, rodar o `ingest` de novo continua de onde parou.

## Estrutura

```
src/core/            o RAG: tipos, loaders, chunkers, embedders, llms, stores, retrieval, eval
src/cli/             bun run rag
src/api/             bun run api
src/mcp/             bun run mcp
public/index.html    a interface (servida pela API em /)
src/rag.config.ts    o "plug": monta o pipeline a partir do .env (src/env.ts valida as variáveis)
test/                testes (embedder e LLM falsos, sem servidor)
collections/         uma subpasta por coleção (só o exemplo vai para o git)
evaluations/         perguntas de avaliação por coleção
docs/                arquitetura com diagramas
```

## Testes

```bash
bun run typecheck
bun test                       # unitários, sem banco nem modelo (embedder e LLM falsos)
```

Os testes de integração do pgvector rodam quando `TEST_DATABASE_URL` está definido (o `docker-compose` já cria o banco `rag_test`).

## Lacunas conhecidas

O projeto é de estudo. Ficaram de fora, de propósito:

- **Reranker.** Hoje a ordem final vem do RRF. Um reranker (cross-encoder, como o `bge-reranker-v2-m3`) lê pergunta e trecho juntos e reordena os candidatos com bem mais precisão. O Ollama não tem endpoint de rerank, então isso exige outro servidor (TEI, Infinity) ou uma API paga (Cohere, Jina, Voyage). Usar um LLM de chat para dar nota a cada trecho funciona, mas é lento rodando local.
- **Dados estruturados.** Perguntas como "quanto faturei em março?" são agregações: busca por similaridade não resolve. O caminho seria text-to-SQL como ferramenta à parte.
- **Dimensão fixa.** Todas as coleções compartilham uma tabela com `vector(768)`. Usar modelos de embedding diferentes por coleção pediria uma tabela por dimensão.
- **PDF escaneado.** Sem OCR: página só com imagem não tem texto e é ignorada.
- **Histórico de conversa.** Cada pergunta é independente; "e no plano Pro?" não lembra a pergunta anterior.
- **Autenticação e limites na API.** Ela foi pensada para rodar localmente.

## Licença

[MIT](LICENSE)
