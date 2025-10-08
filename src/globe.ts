import type { Env } from "./types";

export default async function globeHandler(request: Request, env: Env): Promise<Response> {
  // Implement multiplayer globe logic here
  return new Response(JSON.stringify({ status: "globe endpoint placeholder" }), { status: 200 });
}
