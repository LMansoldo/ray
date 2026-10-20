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
  deleteAssistant,
  listAssistants,
  startSession,
  appendTranscript,
  endSession,
  rollSessionSummary,
  translate,
  saveCredential,
  deleteCredential,
  getCredentials,
  getSettings,
  saveSettings,
  listSessions,
  getSessionDetail,
  getSessionReport,
} from "./handlers.js";
import type { HealthResponse } from "./contract.js";
import { initDb, seedDefaults } from "./boot.js";

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
    const body: HealthResponse = { status: "ok", version: VERSION, dbReady };
    return sendJson(res, 200, body);
  }

  // GET /credentials — sem body
  if (method === "GET" && url === "/credentials") {
    const result = await getCredentials();
    return sendJson(res, 200, result);
  }

  // GET /assistants — sem body
  if (method === "GET" && url === "/assistants") {
    const result = await listAssistants();
    return sendJson(res, 200, result);
  }

  // DELETE /assistants/:id — remove assistente USER (BUILTIN recusado)
  const assistantMatch = url.match(/^\/assistants\/([^/]+)$/);
  if (method === "DELETE" && assistantMatch) {
    const result = await deleteAssistant({ assistantId: assistantMatch[1] });
    return sendJson(res, 200, result);
  }

  // GET /sessions — últimas sessões (RF-802)
  if (method === "GET" && url === "/sessions") {
    const result = await listSessions();
    return sendJson(res, 200, result);
  }

  // GET /sessions/:id — detalhe com transcrição
  const sessionMatch = url.match(/^\/sessions\/([^/]+)$/);
  if (method === "GET" && sessionMatch) {
    const result = await getSessionDetail({ sessionId: sessionMatch[1] });
    return sendJson(res, 200, result);
  }

  // GET /sessions/:id/report?format=md|html — relatório exportável (T-604)
  const reportMatch = url.match(/^\/sessions\/([^/]+)\/report(\?.*)?$/);
  if (method === "GET" && reportMatch) {
    const query = new URLSearchParams(reportMatch[2] ?? "");
    const result = await getSessionReport({
      sessionId: reportMatch[1],
      format: query.get("format") ?? undefined,
    });
    return sendJson(res, 200, result);
  }

  // GET /settings — features + atalhos persistidos
  if (method === "GET" && url === "/settings") {
    const result = await getSettings();
    return sendJson(res, 200, result);
  }

  // PUT /settings — valida e persiste features e/ou atalhos
  if (method === "PUT" && url === "/settings") {
    const reqBody = await readJson<Parameters<typeof saveSettings>[0]>(req);
    const result = await saveSettings(reqBody);
    return sendJson(res, 200, result);
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
    "POST /sessions/summary/roll": rollSessionSummary,
    "POST /translate": translate,
    "POST /credentials": saveCredential,
    "DELETE /credentials": deleteCredential,
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

// Boot: garante o schema SQLite antes de aceitar conexoes. O Rust so
// considera o sidecar pronto apos ler RAY_SIDECAR_PORT do stdout — se o
// init falhar, exit(1) e o supervisor reinicia com backoff (sidecar.rs).
async function main(): Promise<void> {
  await initDb();
  await seedDefaults();
  dbReady = true;
  start();
}

/** Reflete o estado real do banco para o healthcheck (T-300). */
let dbReady = false;

// Watchdog: se o núcleo Ray morrer, o sidecar se encerra (sem órfãos).
const parentPid = Number(process.env.RAY_PARENT_PID ?? "");
if (parentPid > 0) {
  const timer = setInterval(() => {
    if (process.ppid !== parentPid) {
      process.stderr.write("[sidecar] núcleo encerrou — saindo\n");
      process.exit(0);
    }
  }, 2_000);
  timer.unref();
}

main().catch((e) => {
  process.stderr.write(`[sidecar] boot failed: ${(e as Error).message}\n`);
  process.exit(1);
});
