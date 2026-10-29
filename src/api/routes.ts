import type { BunRequest } from "bun";
import { join } from "node:path";
import { DirectoryLoader } from "../core";
import {
  assertCollectionName,
  collectionPath,
  listCollections,
} from "../collections";
import type { App } from "../rag.config";
import { errorResponse } from "./errors";
import { parseQueryBody } from "./query-body";
import { eventStream, wantsEventStream } from "./sse";

const PAGE = join(import.meta.dir, "../../public/index.html");

async function postIngestion(
  app: App,
  request: BunRequest<"/collections/:name/ingestions">,
): Promise<Response> {
  try {
    const root = await collectionPath(app.collectionsDir, request.params.name);
    const options = {
      collection: request.params.name,
      loader: new DirectoryLoader(root),
    };
    if (!wantsEventStream(request)) {
      return Response.json(
        { data: await app.rag.ingest(options) },
        { status: 201 },
      );
    }
    return eventStream(request, async (send) => {
      const report = await app.rag.ingest({
        ...options,
        onProgress: (event) => send("progress", event),
      });
      send("done", report);
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function postQuery(
  app: App,
  request: BunRequest<"/collections/:name/queries">,
): Promise<Response> {
  try {
    const collection = request.params.name;
    assertCollectionName(collection);
    const { question, ...options } = await parseQueryBody(request);
    const query = {
      collection,
      query: question,
      ...options,
      signal: request.signal,
    };

    if (request.headers.get("accept")?.includes("application/json")) {
      const answer = await app.rag.ask(query);
      let text = "";
      for await (const token of answer.text) text += token;
      return Response.json({
        data: {
          answer: text,
          found: answer.found,
          sources: answer.sources,
        },
      });
    }

    return eventStream(request, async (send) => {
      const answer = await app.rag.ask({
        ...query,
        onTrace: (event) => send("trace", event),
      });
      send("sources", { found: answer.found, sources: answer.sources });
      for await (const token of answer.text) send("token", { text: token });
      send("done", {});
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function createRoutes(app: App) {
  return {
    "/": () => new Response(Bun.file(PAGE)),

    "/health": () => Response.json({ status: "ok" }),

    "/collections": {
      GET: async () =>
        Response.json({ data: await listCollections(app.collectionsDir) }),
    },

    "/collections/:name/ingestions": {
      POST: (request: BunRequest<"/collections/:name/ingestions">) =>
        postIngestion(app, request),
    },

    "/collections/:name/queries": {
      POST: (request: BunRequest<"/collections/:name/queries">) =>
        postQuery(app, request),
    },
  };
}
