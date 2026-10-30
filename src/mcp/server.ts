/**
 * Servidor MCP via stdio. O stdout é o canal do protocolo: nada aqui pode
 * escrever nele, então logs vão para o stderr (console.error).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { MAX_QUESTION_LENGTH, sourceLabel, type RetrievedChunk } from "../core";
import { assertCollectionName, listCollections } from "../collections";
import { errorBody } from "../api/errors";
import { createApp } from "../rag.config";

const MAX_TOP_K = 20;

const queryInput = {
  collection: z.string().describe("Nome da coleção, como vem de list_collections."),
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  topK: z.number().int().min(1).max(MAX_TOP_K).optional().describe("Quantos trechos trazer."),
  filter: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .describe("Filtro exato por metadado do documento, ex.: { \"plano\": \"pro\" }."),
};

function text(value: string): CallToolResult {
  return { content: [{ type: "text", text: value }] };
}

async function run(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    const { code, message } = errorBody(error);
    return { ...text(`${code}: ${message}`), isError: true };
  }
}

function similarityLabel(similarity: number | null): string {
  return similarity === null ? "só texto" : `similaridade ${similarity.toFixed(3)}`;
}

function formatChunks(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => `[${i + 1}] (fonte: ${sourceLabel(chunk)} · ${similarityLabel(chunk.similarity)})\n${chunk.text}`)
    .join("\n\n---\n\n");
}

const app = await createApp();

const server = new McpServer({ name: "rag-kit", version: "0.1.0" });

server.registerTool(
  "list_collections",
  {
    description: "Lista as coleções de documentos disponíveis para busca.",
    annotations: { readOnlyHint: true },
  },
  () =>
    run(async () => {
      const names = await listCollections(app.collectionsDir);
      return text(names.length > 0 ? names.join("\n") : "Nenhuma coleção encontrada.");
    }),
);

server.registerTool(
  "search",
  {
    description:
      "Busca híbrida (vetorial + full-text) numa coleção. Devolve os trechos mais relevantes com a fonte de cada um, sem passar por LLM. Use para responder com base nos documentos e citar as fontes.",
    inputSchema: queryInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ collection, question, topK, filter }) =>
    run(async () => {
      assertCollectionName(collection);
      const chunks = await app.rag.retrieve({
        collection,
        query: question,
        ...(topK && { topK }),
        ...(filter && { filter }),
      });
      return text(chunks.length > 0 ? formatChunks(chunks) : "Nenhum trecho relevante encontrado.");
    }),
);

server.registerTool(
  "ask",
  {
    description:
      "Responde a pergunta com o pipeline RAG completo: busca os trechos e gera a resposta com o LLM configurado no rag-kit, citando as fontes como [n].",
    inputSchema: queryInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ collection, question, topK, filter }, { signal }) =>
    run(async () => {
      assertCollectionName(collection);
      const answer = await app.rag.ask({
        collection,
        query: question,
        signal,
        ...(topK && { topK }),
        ...(filter && { filter }),
      });

      let response = "";
      for await (const token of answer.text) response += token;
      if (answer.sources.length === 0) return text(response);

      const sources = answer.sources
        .map((source) => `[${source.index}] ${source.label} (${similarityLabel(source.similarity)})`)
        .join("\n");
      return text(`${response}\n\nFontes:\n${sources}`);
    }),
);

const transport = new StdioServerTransport();

let closing = false;
// server.close() dispara transport.onclose de novo: a trava evita fechar o pool duas vezes.
const shutdown = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await server.close();
  await app.close();
  process.exit(0);
};
transport.onclose = () => void shutdown();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => console.error("Promise rejeitada sem tratamento:", reason));

await server.connect(transport);
console.error("rag-kit MCP pronto (stdio)");
