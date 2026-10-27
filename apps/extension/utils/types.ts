export interface StoredSession {
  access_token: string;
  /** Without this the panel locks itself out when the access token expires. */
  refresh_token?: string;
  email?: string;
}

export interface ProjectRow {
  id: string;
  name: string;
}

export interface CapturePageData {
  url: string;
  title: string;
  html: string;
  screenshot?: string | null;
}

export interface CapturePageResult {
  ok: boolean;
  event_id?: string;
  page_id?: string;
  chunks?: number;
  url?: string;
  title?: string;
  text_chars?: number;
  snapshot_path?: string | null;
  screenshot_path?: string | null;
  duplicate?: boolean;
  note?: string;
  error?: string;
  latency_ms?: number;
  project?: string;
  platform?: string;
}

export interface AskResult {
  ok: boolean;
  answer: string | null;
  note?: string;
  sources?: { ref: string; id: string; similarity: number | null; snippet: string }[];
  model?: string;
  reranked?: boolean;
  latency_ms?: number;
  error?: string;
}