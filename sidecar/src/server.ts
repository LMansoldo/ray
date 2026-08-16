// Servidor HTTP do sidecar (ADR-005): loopback 127.0.0.1, porta efêmera.
// Usa apenas o módulo http nativo do Node para não acoplar o scaffold a um
// framework. TASK: pode-se trocar por Fastify/Express ao implementar, desde
// que os caminhos e shapes do contrato sejam preservados.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  validateCredential,
  suggestStream,
  analyze,
  createAssistant,
  startSession,
  appendTranscript,
  endSession,
  translate,
} from "./handlers.js";
import type { HealthResponse } from "./contract.js";

const VERSION = "0.0.0";

function readJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as T) : ({} as T));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const data = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  // GET /health
  if (method === "GET" && url === "/health") {
    const body: HealthResponse = { status: "ok", version: VERSION, dbReady: false };
    return sendJson(res, 200, body);
  }

  // POST /copilot/suggest — streaming SSE
  if (method === "POST" && url === "/copilot/suggest") {
    const reqBody = await readJson<Parameters<typeof suggestStream>[0]>(req);
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    for await (const event of suggestStream(reqBody)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
    return;
  }

  // Endpoints não-streaming: nome -> handler
  const handlers: Record<string, (b: any) => Promise<unknown>> = {
    "POST /providers/validate": validateCredential,
    "POST /copilot/analyze": analyze,
    "POST /assistants": createAssistant,
    "POST /sessions/start": startSession,
    "POST /sessions/transcript": appendTranscript,
    "POST /sessions/end": endSession,
    "POST /translate": translate,
  };

  const key = `${method} ${url}`;
  const handler = handlers[key];
  if (handler) {
    const reqBody = await readJson<any>(req);
    const result = await handler(reqBody);
    return sendJson(res, 200, result);
  }

  sendJson(res, 404, { ok: false, error: { code: "BAD_REQUEST", message: "no route" } });
}

export function start(): void {
  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      sendJson(res, 500, {
        ok: false,
        error: { code: "INTERNAL", message: (e as Error).message },
      });
    });
  });

  // Porta 0 = efêmera atribuída pelo SO; bind apenas em loopback (ADR-005).
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    // O Rust lê esta linha do stdout para descobrir a porta (ADR-005).
    process.stdout.write(`RAY_SIDECAR_PORT=${port}\n`);
  });
}

start();
