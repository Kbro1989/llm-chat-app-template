/**
 * Unified LLM Chat App Worker
 *
 * Handles:
 * - Chat with LLM
 * - Text-to-Image generation
 * - Multiplayer Globe AI
 * - KV-based session memory
 * - D1 logging of all requests/responses
 * - Static assets
 */

import { Env, ChatMessage } from "./types";

// Model ID for Workers AI chat
const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Free Cloudflare AI endpoints
const IMAGE_MODEL = "@cf/stable-diffusion-v1.5";
const GLOBE_MODEL = "@cf/multiplayer-globe";

// Default system prompt
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve static assets
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // --- API Routes ---
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      try {
        const body = await request.json();

        // Chat route
        if (url.pathname === "/api/chat") {
          return handleChat(body.messages, env);
        }

        // Text-to-Image route
        if (url.pathname === "/api/text-to-image") {
          return handleTextToImage(body.prompt, env);
        }

        // Multiplayer Globe route
        if (url.pathname === "/api/multiplayer-globe") {
          return handleGlobe(body.prompt, env);
        }

        return new Response("Endpoint not found", { status: 404 });
      } catch (error) {
        console.error("API error:", error);
        return new Response(JSON.stringify({ error: "Failed to process request" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

// --- Handlers ---

async function handleChat(messages: ChatMessage[], env: Env): Promise<Response> {
  // Prepend system prompt if missing
  if (!messages.some((msg) => msg.role === "system")) {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }

  // Run LLM
  const response = await env.AI.run(
    CHAT_MODEL,
    { messages, max_tokens: 1024 },
    { returnRawResponse: true }
  );

  // Log to D1
  await logToD1("chat", messages, response, env);

  // Store memory in KV
  const sessionKey = `chat:${Date.now()}`;
  await env.AI_MEMORY.put(sessionKey, JSON.stringify({ messages, response }));

  return response;
}

async function handleTextToImage(prompt: string, env: Env): Promise<Response> {
  const result = await env.TEXT_TO_IMAGE.run(
    IMAGE_MODEL,
    { prompt, max_tokens: 2048 },
    { returnRawResponse: true }
  );

  await logToD1("text-to-image", { prompt }, result, env);

  return result;
}

async function handleGlobe(prompt: string, env: Env): Promise<Response> {
  const result = await env.MULTIPLAYER_GLOBE.run(
    GLOBE_MODEL,
    { prompt, max_tokens: 2048 },
    { returnRawResponse: true }
  );

  await logToD1("multiplayer-globe", { prompt }, result, env);

  return result;
}

// --- Logging to D1 ---
async function logToD1(
  endpoint: string,
  requestData: any,
  responseData: any,
  env: Env
) {
  const timestamp = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO logs (endpoint, request_data, response_data, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(endpoint, JSON.stringify(requestData), JSON.stringify(responseData), timestamp).run();
}
