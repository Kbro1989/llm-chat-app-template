/**
 * Professional LLM + File Management Worker
 *
 * Supports:
 *  - /api/chat          : Free LLM chat (streaming)
 *  - /api/embed         : Generate embeddings for text (free-tier)
 *  - /api/summarize     : Summarize files, code, or chat context
 *  - /api/moderate      : Moderate content
 *  - /api/file-tree     : CRUD for project folders/files
 *  - /api/files         : CRUD for file contents with versioning
 *
 * Uses:
 *  - D1 binding "PROJECT_DB" for persistent storage
 *  - KV binding "AI_MEMORY" for session/context memory
 *  - Assets binding "ASSETS" for frontend static files
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve frontend assets
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Handle API routes
    try {
      if (url.pathname === "/api/chat" && request.method === "POST") {
        return handleChatRequest(request, env);
      }

      if (url.pathname === "/api/embed" && request.method === "POST") {
        return handleEmbedRequest(request, env);
      }

      if (url.pathname === "/api/summarize" && request.method === "POST") {
        return handleSummarizeRequest(request, env);
      }

      if (url.pathname === "/api/moderate" && request.method === "POST") {
        return handleModerateRequest(request, env);
      }

      if (url.pathname.startsWith("/api/file-tree")) {
        return handleFileTree(request, env);
      }

      if (url.pathname.startsWith("/api/files")) {
        return handleFiles(request, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("API error:", err);
      return new Response(JSON.stringify({ error: "Server error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  },
} satisfies ExportedHandler<Env>;

/** --------------------- AI Chat --------------------- */
async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  const { messages = [] } = (await request.json()) as { messages: ChatMessage[] };
  if (!messages.some((msg) => msg.role === "system")) {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }

  const response = await env.AI.run(MODEL_ID, { messages, max_tokens: 1024 }, { returnRawResponse: true });
  return response;
}

/** --------------------- Embeddings --------------------- */
async function handleEmbedRequest(request: Request, env: Env): Promise<Response> {
  const { text } = await request.json();
  const result = await env.AI.embed({
    model: "text-embedding-3-small",
    input: text,
  });
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
}

/** --------------------- Summarization --------------------- */
async function handleSummarizeRequest(request: Request, env: Env): Promise<Response> {
  const { text } = await request.json();
  const messages: ChatMessage[] = [
    { role: "system", content: "Summarize the following text concisely." },
    { role: "user", content: text },
  ];

  const response = await env.AI.run(MODEL_ID, { messages, max_tokens: 512 }, { returnRawResponse: true });
  return response;
}

/** --------------------- Moderation --------------------- */
async function handleModerateRequest(request: Request, env: Env): Promise<Response> {
  const { text } = await request.json();
  const result = await env.AI.moderate({ input: text });
  return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
}

/** --------------------- File Tree CRUD --------------------- */
async function handleFileTree(request: Request, env: Env): Promise<Response> {
  const db = env.PROJECT_DB;

  switch (request.method) {
    case "GET": {
      const result = await db.prepare("SELECT * FROM file_tree ORDER BY parent_id, name").all();
      return new Response(JSON.stringify(result.results), { headers: { "content-type": "application/json" } });
    }
    case "POST": {
      const { name, parent_id = null, type } = await request.json();
      const result = await db.prepare(
        "INSERT INTO file_tree (name, parent_id, type) VALUES (?, ?, ?)"
      ).run(name, parent_id, type);
      return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
    }
    case "PUT": {
      const { id, name } = await request.json();
      const result = await db.prepare("UPDATE file_tree SET name = ? WHERE id = ?").run(name, id);
      return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
    }
    case "DELETE": {
      const { id } = await request.json();
      const result = await db.prepare("DELETE FROM file_tree WHERE id = ?").run(id);
      return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
    }
    default:
      return new Response("Method not allowed", { status: 405 });
  }
}

/** --------------------- File Content CRUD --------------------- */
async function handleFiles(request: Request, env: Env): Promise<Response> {
  const db = env.PROJECT_DB;

  switch (request.method) {
    case "GET": {
      const { file_id } = new URL(request.url).searchParams;
      const result = await db.prepare("SELECT * FROM files WHERE id = ?").get(file_id);
      return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
    }
    case "POST": {
      const { file_id, content } = await request.json();
      const result = await db.prepare(
        "INSERT INTO files (id, content, version) VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET content=excluded.content, version=version+1"
      ).run(file_id, content);
      return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
    }
    default:
      return new Response("Method not allowed", { status: 405 });
  }
}
