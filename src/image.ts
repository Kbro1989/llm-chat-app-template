import type { Env } from "./types";

export default async function imageHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const { prompt } = await request.json();
    const response = await env.AI.run("@cf/meta/stable-diffusion-v1.5", { prompt, n: 1 });
    return new Response(JSON.stringify(response), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
