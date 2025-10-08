import { Ai } from "@cloudflare/ai";
import { serveStatic } from "@cloudflare/pages-plugin-static";
import { D1Database } from "@cloudflare/workers-types";

interface Env {
  AI: Ai;
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // === STATIC FILES ===
    if (!path.startsWith("/api/")) {
      return serveStatic(req, {
        ASSETS: env.ASSETS,
        root: "public",
        defaultDocument: "index.html",
      });
    }

    // === AI CHAT ===
    if (path === "/api/chat" && req.method === "POST") {
      const { message } = await req.json();
      const ai = new Ai(env.AI);
      const reply = await ai.run("@cf/meta/llama-3.1-8b-instruct", { messages: [{ role: "user", content: message }] });
      return Response.json({ reply });
    }

    // === TEXT → IMAGE ===
    if (path === "/api/image" && req.method === "POST") {
      const { prompt } = await req.json();
      const ai = new Ai(env.AI);
      const img = await ai.run("@cf/stabilityai/stable-diffusion-xl-base-1.0", { prompt });
      return Response.json({ image: img });
    }

    // === D1 FILE STRUCTURE ===
    if (path.startsWith("/api/structure/")) {
      const projectId = path.split("/").pop();
      const folders = await env.DB.prepare("SELECT * FROM folders WHERE project_id = ?").bind(projectId).all();
      const files = await env.DB.prepare("SELECT * FROM files WHERE project_id = ?").bind(projectId).all();
      return Response.json({ folders: folders.results, files: files.results });
    }

    if (path === "/api/folders" && req.method === "POST") {
      const { project_id, name } = await req.json();
      await env.DB.prepare("INSERT INTO folders (project_id, name) VALUES (?, ?)").bind(project_id, name).run();
      return Response.json({ ok: true });
    }

    if (path === "/api/files" && req.method === "POST") {
      const { project_id, name } = await req.json();
      await env.DB.prepare("INSERT INTO files (project_id, folder_id, name, content) VALUES (?, NULL, ?, '')").bind(project_id, name).run();
      return Response.json({ ok: true });
    }

    if (path === "/api/update" && req.method === "POST") {
      const { file_id, content } = await req.json();
      await env.DB.prepare("UPDATE files SET content = ? WHERE file_id = ?").bind(content, file_id).run();
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
};
