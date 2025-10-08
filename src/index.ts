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
      if (Array.isArray(mem)) messages.push(...mem);
    }
  } catch (e) {
    console.warn("session memory read failed", e);
  }

  // Call LLM (streaming raw response returned)
  const aiResponse = await env.AI.run(
    MODEL_LLM,
    { messages, max_tokens: 1024 },
    { returnRawResponse: true }
  );

  // Save chat into D1 (chats table)
  try {
    const id = crypto.randomUUID();
    const timestamp = nowIso();
    const summary = JSON.stringify(messages); // store messages as JSON; could store pruned summary separately
    await env.DB.prepare(
      `INSERT INTO chats (id, session_id, timestamp, messages_json) VALUES (?, ?, ?, ?)`
    ).bind(id, sessionId, timestamp, summary).run();
  } catch (err) {
    console.error("D1 insert chat failed:", err);
  }

  // Persist last 10 messages to KV for session memory
  try {
    const lastN = messages.slice(-10);
    await env.AI_MEMORY.put(`session:${sessionId}`, JSON.stringify(lastN));
  } catch (err) {
    console.warn("KV write session memory failed", err);
  }

  // Return the raw streaming response so frontend can stream
  return aiResponse;
}

/**
 * POST /api/text-to-image
 * body: { prompt: string, size?: string, session_id?: string }
 * - Calls Workers AI image generation
 * - Stores image bytes (base64) into KV under key images:<id>
 * - Stores image metadata into D1 table `images`
 * - Returns metadata plus access URL (via this worker endpoint /api/images/:id)
 */
async function handleTextToImage(request: Request, env: Env): Promise<Response> {
  const body = (await parseJson(request)) || {};
  const prompt: string = (body.prompt || "").trim();
  const size: string = body.size || "1024x1024";
  const sessionId: string = body.session_id || `anon:${Date.now()}`;

  if (!prompt) return errorResponse("Image prompt required", 400);

  // Generate via AI.run (image model) — using returnRawResponse:false so we can parse JSON
  // Note: Workers AI may return different shapes; we handle common possibilities
  let imageResult: any;
  try {
    const raw = await env.AI.run(MODEL_IMAGE, { prompt, size }, { returnRawResponse: false });
    imageResult = raw;
  } catch (err) {
    console.error("Image generation failed", err);
    return errorResponse("Image generation failed");
  }

  // Try to extract base64 from common response shapes
  // Common shapes: { data: [{ b64_json: "..." }]} or { images: [{ url: "https://..." }]}
  let b64: string | null = null;
  let urlAvailable: string | null = null;

  if (imageResult && typeof imageResult === "object") {
    if (Array.isArray(imageResult.data) && imageResult.data[0]?.b64_json) {
      b64 = imageResult.data[0].b64_json;
    } else if (Array.isArray(imageResult.images) && imageResult.images[0]?.b64_json) {
      b64 = imageResult.images[0].b64_json;
    } else if (typeof imageResult.url === "string") {
      urlAvailable = imageResult.url;
    } else if (Array.isArray(imageResult.data) && imageResult.data[0]?.url) {
      urlAvailable = imageResult.data[0].url;
    }
  }

  // If the model produced a URL but not base64, attempt to fetch and base64-encode it
  if (!b64 && urlAvailable) {
    try {
      const fetchRes = await fetch(urlAvailable);
      const arrayBuffer = await fetchRes.arrayBuffer();
      const u8 = new Uint8Array(arrayBuffer);
      const chunk = Buffer.from(u8).toString("base64");
      b64 = chunk;
    } catch (err) {
      console.warn("Failed to fetch/encode image from url:", err);
    }
  }

  // If still no b64, attempt to check imageResult as text
  if (!b64 && typeof imageResult === "string") {
    // not expected, but safe fallback
    b64 = Buffer.from(imageResult).toString("base64");
  }

  if (!b64) {
    // We still have something — store whatever result JSON we got as metadata and fail gracefully
    console.warn("No base64 image produced; storing metadata only.");
  }

  // Prepare IDs and timestamps
  const imageId = crypto.randomUUID();
  const createdAt = nowIso();

  // Store base64 in KV (AI_MEMORY) under key images:<id>
  try {
    if (b64) {
      await env.AI_MEMORY.put(`images:${imageId}`, b64);
    }
  } catch (err) {
    console.error("Failed to store image bytes in KV:", err);
  }

  // Insert metadata into D1 `images`
  try {
    const metaJson = JSON.stringify({ model: MODEL_IMAGE, prompt, size, raw: imageResult });
    await env.DB.prepare(
      `INSERT INTO images (id, session_id, created_at, prompt, size, meta_json, has_b64)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(imageId, sessionId, createdAt, prompt, size, metaJson, b64 ? 1 : 0).run();
  } catch (err) {
    console.error("Failed to insert image metadata into D1:", err);
  }

  // Return metadata + image access endpoint
  const accessUrl = `https://llm-chat-app-template.kristain33rs.workers.dev/api/images/${imageId}`;
  return jsonResponse({
    id: imageId,
    created_at: createdAt,
    prompt,
    size,
    access_url: accessUrl,
    has_base64: !!b64,
    meta: imageResult,
  });
}

/**
 * POST /api/embeddings
 * body: { text: string, namespace?: string }
 * - Generates embedding using env.AI.embed
 * - Stores embedding vector in KV under key embedding:<id> or embedding:<namespace>:<id>
 */
async function handleEmbeddings(request: Request, env: Env): Promise<Response> {
  const body = (await parseJson(request)) || {};
  const text: string = (body.text || "").trim();
  const namespace: string = body.namespace || "default";

  if (!text) return errorResponse("Text is required for embeddings", 400);

  try {
    const embedRes = await env.AI.embed({
      model: EMBED_MODEL,
      input: text,
    });

    // embedRes may contain embedding array under embedRes.data[0].embedding or embedRes.embedding
    const vector = (embedRes?.data && embedRes.data[0]?.embedding) || embedRes?.embedding || null;

    if (!vector) {
      // store raw embedRes for debugging if shape unexpected
      await env.AI_MEMORY.put(`embedding:raw:${crypto.randomUUID()}`, JSON.stringify(embedRes));
      return jsonResponse({ ok: false, note: "Embedding generated but shape unexpected; stored raw response." }, 200);
    }

    const id = crypto.randomUUID();
    await env.AI_MEMORY.put(`embedding:${namespace}:${id}`, JSON.stringify({ text, vector }));

    // Optionally write small index entry into D1 for searchability
    try {
      const createdAt = nowIso();
      await env.DB.prepare(
        `INSERT INTO embeddings (id, namespace, created_at, text_snippet) VALUES (?, ?, ?, ?)`
      ).bind(id, namespace, createdAt, text.slice(0, 256)).run();
    } catch (err) {
      console.warn("Failed to insert embedding index into D1:", err);
    }

    return jsonResponse({ id, namespace });
  } catch (err) {
    console.error("Embedding generation error:", err);
    return errorResponse("Failed to generate embedding");
  }
}

/**
 * GET /api/images
 * - returns recent images metadata from D1
 */
async function handleListImages(_req: Request, env: Env): Promise<Response> {
  try {
    const res = await env.DB.prepare("SELECT id, created_at, prompt, size, has_b64 FROM images ORDER BY created_at DESC LIMIT 50").all();
    return jsonResponse(res.results || []);
  } catch (err) {
    console.error("Failed to list images:", err);
    return errorResponse("Failed to list images");
  }
}

/**
 * GET /api/images/:id
 * - returns image base64 from KV (AI_MEMORY) as JSON { b64: "...", content_type: "image/png" }.
 * - client can convert to data URL: data:image/png;base64,<b64>
 */
async function handleGetImage(imageId: string, env: Env): Promise<Response> {
  try {
    const b64 = await env.AI_MEMORY.get(`images:${imageId}`);
    if (!b64) return errorResponse("Image not found", 404);
    return jsonResponse({ id: imageId, b64 });
  } catch (err) {
    console.error("Failed to fetch image from KV:", err);
    return errorResponse("Failed to fetch image");
  }
}

/**
 * POST /api/log-build
 * - called by CI (postbuild) with body { timestamp, source, log_text }
 * - stores into D1 build_logs table
 */
async function handleBuildLog(request: Request, env: Env): Promise<Response> {
  const body = (await parseJson(request)) || {};
  const timestamp = body.timestamp || nowIso();
  const source = body.source || "cloudflare-build";
  const logText = body.log_text || body.log || "";

  if (!logText) return errorResponse("Missing build log text", 400);

  try {
    await env.DB.prepare(
      `INSERT INTO build_logs (timestamp, source, log_text) VALUES (?, ?, ?)`
    ).bind(timestamp, source, logText).run();
    return jsonResponse({ success: true });
  } catch (err) {
    console.error("D1 insert build log failed:", err);
    return errorResponse("Failed to write build log to D1");
  }
}

/**
 * GET /api/logs
 * - returns latest build_logs and general logs
 */
async function handleFetchLogs(env: Env): Promise<Response> {
  try {
    const res = await env.DB.prepare(
      `SELECT id, timestamp, source, log_text FROM build_logs ORDER BY id DESC LIMIT 50`
    ).all();
    return jsonResponse(res.results || []);
  } catch (err) {
    console.error("Failed to fetch logs:", err);
    return errorResponse("Failed to fetch logs");
  }
}

/**
 * GET /api/file-tree
 * - returns a JSON file-tree stored in KV at key 'file_tree' (AI-managed)
 */
async function handleGetFileTree(env: Env): Promise<Response> {
  try {
    const tree = await env.AI_MEMORY.get("file_tree");
    return jsonResponse(tree ? JSON.parse(tree) : { root: [] });
  } catch (err) {
    console.error("Failed to get file tree from KV:", err);
    return errorResponse("Failed to get file tree");
  }
}

/**
 * POST /api/project-file
 * body: { path: string, content: string, editor: 'AI' | 'user', session_id?: string }
 * - writes file content to KV under 'file:<path>'
 * - records an edit log in D1 table `file_edits`
 */
async function handleWriteProjectFile(request: Request, env: Env): Promise<Response> {
  const body = (await parseJson(request)) || {};
  const path: string = body.path;
  const content: string = body.content;
  const editor: string = body.editor || "AI";
  const sessionId: string = body.session_id || null;

  if (!path || typeof content !== "string") return errorResponse("Missing path or content", 400);

  try {
    // Store content in KV (AI_MEMORY)
    const kvKey = `file:${path}`;
    await env.AI_MEMORY.put(kvKey, content);

    // Insert edit log to D1
    const id = crypto.randomUUID();
    const ts = nowIso();
    await env.DB.prepare(
      `INSERT INTO file_edits (id, file_path, editor, session_id, timestamp)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(id, path, editor, sessionId, ts).run();

    // Optionally update in-memory file_tree (very simple: ensure entry exists)
    try {
      const treeRaw = await env.AI_MEMORY.get("file_tree");
      let tree = treeRaw ? JSON.parse(treeRaw) : { root: [] };
      // naive insert: if no entry exists with path, add it
      if (!tree.root.some((f: any) => f.path === path)) {
        tree.root.push({ path, name: path.split("/").pop(), type: "file", updated_at: ts });
        await env.AI_MEMORY.put("file_tree", JSON.stringify(tree));
      }
    } catch (e) {
      console.warn("failed to update file_tree KV:", e);
    }

    return jsonResponse({ success: true, path });
  } catch (err) {
    console.error("Failed to write project file:", err);
    return errorResponse("Failed to write project file");
  }
}
