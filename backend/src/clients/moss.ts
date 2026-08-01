import { config } from "../config.js";

/**
 * Moss — semantic retrieval (RAG) over the demo patient history + a small medical
 * KB. No tool-calling; it's the retrieval layer. Handoff §4.
 *
 * TODO(keys): with MOSS_PROJECT_ID/KEY, use @moss-dev/moss to index (once, offline)
 * and to query at conversation time.
 */
export const moss = {
  isConfigured: !!(config.moss.projectId && config.moss.projectKey),

  async retrieve(_query: string, _opts?: { k?: number }): Promise<
    Array<{ text: string; score: number; source?: string }>
  > {
    if (!this.isConfigured) throw new Error("Moss not configured (see SETUP.md §4)");
    throw new Error("moss.retrieve not implemented yet — waiting on Moss keys/impl");
  },
};
