import { parseArgs } from "node:util";
import {
  DirectoryLoader,
  evaluate,
  parseEvalCases,
  RagError,
  ValidationError,
  type IngestEvent,
} from "../core";
import {
  assertCollectionName,
  collectionPath,
  listCollections,
} from "../collections";
import { createApp, type App } from "../rag.config";

const HELP = `rag-kit

Uso:
  bun run rag ingest [coleção] [--reset] [--no-prune]   indexa collections/<coleção> (sem nome: todas)
  bun run rag ask <coleção> "pergunta" [--top-k 5]      pergunta para a base
  bun run rag eval <coleção> [--file caminho] [--k 5]   mede a recuperação (padrão: evaluations/<coleção>.json)
`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    reset: { type: "boolean", default: false },
    "no-prune": { type: "boolean", default: false },
    "top-k": { type: "string" },
    file: { type: "string" },
    k: { type: "string", default: "5" },
    help: { type: "boolean", short: "h", default: false },
  },
});

type CliOptions = typeof values;
type Command = (app: App, args: string[], options: CliOptions) => Promise<void>;

function positiveInteger(
  raw: string | undefined,
  name: string,
): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new ValidationError(`--${name} precisa ser um inteiro positivo.`);
  return value;
}

function printProgress(event: IngestEvent): void {
  if (event.type === "removed") {
    console.log(`  - removidos: ${event.documentIds.join(", ")}`);
    return;
  }
  const labels = {
    added: "+ novo",
    updated: "~ atualizado",
    unchanged: "= inalterado",
    empty: "! sem texto",
  };
  const detail = "chunks" in event ? ` (${event.chunks} chunks)` : "";
  console.log(`  ${labels[event.type]}: ${event.documentId}${detail}`);
}

async function runIngest(
  app: App,
  [name]: string[],
  options: CliOptions,
): Promise<void> {
  const names = name ? [name] : await listCollections(app.collectionsDir);
  if (names.length === 0)
    throw new ValidationError(`Nenhuma coleção em ${app.collectionsDir}.`);

  for (const collection of names) {
    const root = await collectionPath(app.collectionsDir, collection);
    if (options.reset) await app.rag.reset(collection);
    console.log(`\nColeção "${collection}"`);
    const started = performance.now();
    const report = await app.rag.ingest({
      collection,
      loader: new DirectoryLoader(root),
      prune: !options["no-prune"],
      onProgress: printProgress,
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(
      `  ${report.added} novos, ${report.updated} atualizados, ${report.unchanged} inalterados, ` +
        `${report.removed} removidos, ${report.chunks} chunks gerados em ${seconds}s`,
    );
  }
}

async function runAsk(
  app: App,
  [collection, ...words]: string[],
  options: CliOptions,
): Promise<void> {
  const question = words.join(" ").trim();
  if (!collection || !question)
    throw new ValidationError('Uso: bun run rag ask <coleção> "pergunta"');
  assertCollectionName(collection);
  const topK = positiveInteger(options["top-k"], "top-k");
  const answer = await app.rag.ask({
    collection,
    query: question,
    ...(topK && { topK }),
  });

  for await (const token of answer.text) process.stdout.write(token);
  process.stdout.write("\n");

  if (answer.sources.length > 0) {
    console.log("\nFontes:");
    for (const source of answer.sources) {
      const similarity =
        source.similarity === null
          ? "só texto"
          : `similaridade ${source.similarity.toFixed(3)}`;
      console.log(`  [${source.index}] ${source.label} (${similarity})`);
    }
  }
}

async function runEval(
  app: App,
  [collection]: string[],
  options: CliOptions,
): Promise<void> {
  if (!collection) throw new ValidationError("Uso: bun run rag eval <coleção>");
  assertCollectionName(collection);
  const k = positiveInteger(options.k, "k") ?? 5;
  const file = Bun.file(options.file ?? `evaluations/${collection}.json`);
  if (!(await file.exists()))
    throw new ValidationError(
      `Arquivo de avaliação não encontrado: ${file.name}`,
    );

  const cases = parseEvalCases(await file.json());
  const report = await evaluate(cases, k, (query) =>
    app.rag.retrieve({ collection, query, topK: k }),
  );

  for (const result of report.cases) {
    const status = (result.rank === null ? "ERROU" : `#${result.rank}`).padEnd(
      6,
    );
    console.log(`${status} ${result.question}`);
    if (result.rank === null)
      console.log(
        `       esperado: ${result.expected.join(", ")} | veio: ${result.retrieved.join(", ") || "nada"}`,
      );
  }
  console.log(
    `\nhit rate@${k}: ${(report.hitRate * 100).toFixed(1)}%   MRR: ${report.mrr.toFixed(3)}   (${report.cases.length} perguntas)`,
  );
}

const COMMANDS = new Map<string, Command>([
  ["ingest", runIngest],
  ["ask", runAsk],
  ["eval", runEval],
]);

async function main(): Promise<void> {
  const [name, ...args] = positionals;
  if (values.help || !name) {
    console.log(HELP);
    return;
  }

  const command = COMMANDS.get(name);
  if (!command)
    throw new ValidationError(`Comando desconhecido: "${name}".\n\n${HELP}`);

  const app = await createApp();
  try {
    await command(app, args, values);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof RagError) {
    console.error(`\nErro (${error.code}): ${error.message}`);
  } else {
    console.error("\nErro inesperado:", error);
  }
  process.exit(1);
});
