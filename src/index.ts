import type { Env, ChatMessage, BuildLog } from "./types";
import imageHandler from "./image";
import globeHandler from "./globe";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYSTEM_PROMPT = "You are a helpful assistant. Provide concise and accurate responses.";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve static assets
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Chat
    if (url.pathname === "/api/chat") {
      if (request.method === "POST") return handleChat(request, env);
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Text-to-image
    if (url.pathname.startsWith("/api/image")) {
      return imageHandler(request, env);
    }

    // Multiplayer globe
    if (url.pathname.startsWith("/api/globe")) {
      return globeHandler(request, env);
    }

    // Build logs
    if (url.pathname === "/api/build-logs") {
      if (request.method === "POST") return handleBuildLogInsert(request, env);
      if (request.method === "GET") return handleBuildLogFetch(env);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** LLM Chat */
async function handleChat(request: Request, env: Env): Promise<Response> {
  const { messages = [] } = await request.json() as { messages: ChatMessage[] };
  if (!messages.some(m => m.role === "system")) {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }

  return env.AI.run(MODEL_ID, { messages, max_tokens: 1024 }, { returnRawResponse: true });
}

/** Build Logs */
async function handleBuildLogInsert(request: Request, env: Env): Promise<Response> {
  try {
    const log = await request.json() as BuildLog;
    await env.D1.prepare(
      `INSERT INTO build_logs
      (id, worker_name, commit_hash, branch, status, started_at, finished_at, duration_ms, log_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run([
      log.id, log.worker_name, log.commit_hash, log.branch,
      log.status, log.started_at, log.finished_at,
      log.duration_ms, log.log_content
    ]);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}

async function handleBuildLogFetch(env: Env): Promise<Response> {
  try {
    const result = await env.D1.prepare("SELECT * FROM build_logs ORDER BY started_at DESC LIMIT 100").all();
    return new Response(JSON.stringify(result.results), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
