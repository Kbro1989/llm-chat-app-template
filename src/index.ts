// Add to switch-case in fetch
case "/api/project":
  if (request.method === "POST") return handleProjectRequest(request, env);
  if (request.method === "GET") return handleProjectList(env);
  return new Response("Method not allowed", { status: 405 });

// ---- Project Management ----
async function handleProjectRequest(request: Request, env: Env): Promise<Response> {
  try {
    const { path, content } = await request.json();
    
    if (!path) return new Response(JSON.stringify({ error: "Missing path" }), { status: 400 });

    // Write/update file in KV
    await env.KV_MEMORY.put(path, content);

    // Log action in D1
    await env.D1_DB.prepare(
      "INSERT INTO project_log (timestamp, path, action) VALUES (?, ?, ?)"
    ).bind(Date.now(), path, "update").run();

    // Optionally: trigger GitHub workflow via API
    // await triggerGitHubBuild(path, content);

    return new Response(JSON.stringify({ success: true, path }), { headers: { "content-type": "application/json" } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Project update failed" }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

async function handleProjectList(env: Env): Promise<Response> {
  try {
    const fileTreeJson = await env.KV_MEMORY.get("file_tree");
    return new Response(fileTreeJson || "{}", { headers: { "content-type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch project files" }), { status: 500, headers: { "content-type": "application/json" } });
  }
}
