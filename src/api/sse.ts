import { errorBody } from "./errors";

export type Send = (event: string, data: unknown) => void;

export function wantsEventStream(request: Request): boolean {
  return request.headers.get("accept")?.includes("text/event-stream") ?? false;
}

/** O status 200 sai antes do trabalho começar, então erros viram um evento `error` dentro do stream. */
export function eventStream(
  request: Request,
  run: (send: Send) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (event, data) => {
        if (request.signal.aborted) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        await run(send);
      } catch (error) {
        send("error", errorBody(error));
      } finally {
        if (!request.signal.aborted) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
