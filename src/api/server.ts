import { loadEnv } from "../env";
import { createApp } from "../rag.config";
import { errorResponse } from "./errors";
import { createRoutes } from "./routes";

const app = await createApp();
const { apiPort } = loadEnv();

const server = Bun.serve({
  port: apiPort,
  // Respostas de LLM rodando em CPU podem passar do padrão de 10s sem enviar bytes.
  idleTimeout: 255,
  routes: createRoutes(app),
  fetch: () =>
    Response.json(
      { error: { code: "NOT_FOUND", message: "Rota não encontrada." } },
      { status: 404 },
    ),
  error: errorResponse,
});

console.log(`rag-kit API em http://localhost:${server.port}`);

const shutdown = async (): Promise<void> => {
  await server.stop();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) =>
  console.error("Promise rejeitada sem tratamento:", reason),
);
