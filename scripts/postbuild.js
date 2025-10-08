// scripts/postbuild.js

import fetch from "node-fetch";

const LOG_ENDPOINT = "https://llm-chat-app-template.kristain33rs.workers.dev/api/log-build";

const run = async () => {
  try {
    // Read Cloudflare build log from environment
    const log = process.env.CF_PAGES_LOGS || "No log text available (manual deploy)";

    const payload = {
      timestamp: new Date().toISOString(),
      source: "cloudflare-build",
      log_text: log,
    };

    const res = await fetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log(`Build log sent to Worker → ${res.status}`);
  } catch (err) {
    console.error("Failed to send build log:", err);
  }
};

run();
