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

    // Chat API route
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChatRequest(request, env);
    }

    // Optional: D1 debug route
    if (url.pathname === "/api/tasks") {
      const tasks = await env.DB.prepare("SELECT * FROM tasks LIMIT 100").all();
      return new Response(JSON.stringify(tasks), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const { messages = [] } = (await request.json()) as { messages: ChatMessage[] };

    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    // Fetch short-term memory from KV
    const memoryJson = await env.AI_MEMORY.get("recent_context", "json");
    if (memoryJson) {
      messages.push(...memoryJson);
    }

    // Run the AI
    const response = await env.AI.run(MODEL_ID, { messages, max_tokens: 1024 }, { returnRawResponse: true });

    // Update KV memory with last 10 messages
    const newMemory = messages.slice(-10);
    await env.AI_MEMORY.put("recent_context", JSON.stringify(newMemory));

    // Optional: log to D1
    await env.DB.prepare(
      "INSERT INTO chat_logs (timestamp, message_count) VALUES (?, ?)"
    ).run([Date.now(), messages.length]);

    return response;
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(JSON.stringify({ error: "Failed to process request" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
