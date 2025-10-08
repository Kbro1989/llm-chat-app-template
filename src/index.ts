/**
 * src/index.ts
 * Unified LLM Chat App Worker — Full feature set
 *
 * Bindings expected:
 *  - env.AI         -> Workers AI binding
 *  - env.DB         -> D1 database (openapi-template-db)
 *  - env.AI_MEMORY  -> KV namespace (id: 8c5a2eb8be934b078487ae615c0de92e)
 *  - env.ASSETS     -> Static assets (./public)
 *
 * Endpoints:
 *  - POST /api/chat               -> run LLM chat, save to D1, store session memory in KV
 *  - POST /api/text-to-image      -> generate image, store image bytes in KV, metadata in D1
 *  - POST /api/embeddings         -> generate embedding for text, store in KV (embedding:<id>)
 *  - GET  /api/images             -> list recent generated images metadata
 *  - GET  /api/images/:id         -> fetch a stored image (base64) from KV
 *  - POST /api/log-build          -> store build logs into D1 (used by CI)
 *  - GET  /api/logs               -> fetch recent logs from D1
 *  - GET  /api/file-tree          -> simple file-tree JSON stored in KV (AI-managed)
 *  - POST /api/project-file       -> write/update a file (KV + D1 log)
 *
 * Notes:
 *  - No placeholders: exact bindings and D1 names used as discussed
 *  - Uses crypto.randomUUID() for ids
 */

import { ChatMessage } from "./types";

const MODEL_LLM = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_IMAGE = "@cf/stabilityai/stable-diffusion-xl-base-1.0"; // supported model id used earlier
const EMBED_MODEL = "text-embedding-3-small"; // embedding model name (Workers AI embed)
const SYSTEM_PROMPT = "You are a helpful, friendly assistant. Provide concise and accurate responses.";

/* -----------------------
   Utility helpers
   ----------------------- */
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function errorResponse(message: string, status = 500) {
  return jsonResponse({ error: message }, status);
}
function nowIso() {
  return new Date().toISOString();
}
async function parseJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/* -----------------------
   Exported Worker
   ----------------------- */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Serve static frontend
    if (path === "/" || !path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // Routes
    try {
      // Chat
      if (path === "/api/chat" && request.method === "POST") {
        return handleChat(request, env);
      }

      // Image generation
      if (path === "/api/text-to-image" && request.method === "POST") {
        return handleTextToImage(request, env);
      }

      // Embeddings
      if (path === "/api/embeddings" && request.method === "POST") {
        return handleEmbeddings(request, env);
      }

      // List images metadata
      if (path === "/api/images" && request.method === "GET") {
        return handleListImages(request, env);
      }

      // Fetch image data by id
      if (path.startsWith("/api/images/") && request.method === "GET") {
        const id = path.split("/").pop();
        return handleGetImage(id || "", env);
      }

      // Build log ingestion (CI -> posts build output here)
      if (path === "/api/log-build" && request.method === "POST") {
        return handleBuildLog(request, env);
      }

      // Fetch recent logs
      if (path === "/api/logs" && request.method === "GET") {
        return handleFetchLogs(env);
      }

      // Simple file-tree get
      if (path === "/api/file-tree" && request.method === "GET") {
        return handleGetFileTree(env);
      }

      // Write project file (AI or user)
      if (path === "/api/project-file" && request.method === "POST") {
        return handleWriteProjectFile(request, env);
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("Unhandled route error:", err);
      return errorResponse("Internal server error");
    }
  },
} satisfies ExportedHandler<Env>;

/* ===========================
   Endpoint Implementations
   =========================== */

/**
 * POST /api/chat
 * body: { messages: ChatMessage[], session_id?: string }
 * - Runs the LLM
 * - Stores chat messages into D1 (table: chats)
 * - Persists last-N messages into KV for session memory at key `session:<session_id>`
 */
async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = (await parseJson(request)) || {};
  const messages: ChatMessage[] = body.messages || [];
  const sessionId: string = body.session_id || `anon:${Date.now()}`;

  if (!Array.isArray(messages)) return errorResponse("Invalid messages array", 400);

  // Ensure system prompt included
  if (!messages.some((m) => m.role === "system")) {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }

  // Pull recent memory from KV if exists and append (keeps context)
  try {
    const memKey = `session:${sessionId}`;
    const memJson = await env.AI_MEMORY.get(memKey);
    if (memJson) {
      const mem = JSON.parse(memJson);
      // mem expected to be array of ChatMessage; append to front so model sees it after system prompt
