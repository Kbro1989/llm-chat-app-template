export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BuildLog {
  id: string;
  worker_name: string;
  commit_hash: string;
  branch: string;
  status: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  log_content: string;
}

export interface Env {
  AI: any;
  D1: D1Database;
  ASSETS: Fetcher;
}
