import { config } from "../config.js";

/**
 * Moss — semantic retrieval (RAG) over the demo patient history + a small medical
 * KB. No tool-calling; it's the retrieval layer. Handoff §4.
 *
 * `@moss-dev/moss` depends on `@moss-dev/moss-core`, which ships native Node
 * addons rather than browser WASM. That only runs server-side — fine, this is
 * the server.
 *
 * `loadIndex()` pulls the index into memory once; every query after that is
 * local (~1ms) instead of a cloud round-trip. That matters here: this sits
 * inside a live voice call, where a 300ms retrieval is an audible pause.
 */

export interface MossHit {
  text: string;
  score: number;
  source?: string;
}

/** Index with the demo patient history + medical KB. Build it with `npm run moss:index`. */
export const CLINICAL_INDEX = process.env.MOSS_INDEX_NAME ?? "oido-clinical";

type MossClientLike = {
  createIndex(name: string, docs: unknown[]): Promise<unknown>;
  deleteIndex(name: string): Promise<boolean>;
  loadIndex(name: string): Promise<string>;
  listIndexes(): Promise<{ name: string; docCount: number }[]>;
  query(
    name: string,
    q: string,
    o?: { topK?: number },
  ): Promise<{ docs: { text: string; score: number; metadata?: Record<string, string> }[] }>;
};

let clientPromise: Promise<MossClientLike> | undefined;
const loaded = new Set<string>();

async function getClient(): Promise<MossClientLike> {
  if (!clientPromise) {
    // Non-literal specifier on purpose: @moss-dev/moss's published types
    // reference a tsconfig.json that isn't in the tarball, which breaks tsc.
    const specifier = "@moss-dev/moss";
    clientPromise = import(specifier).then(
      (m) => new m.MossClient(config.moss.projectId, config.moss.projectKey) as MossClientLike,
    );
  }
  return clientPromise;
}

export const moss = {
  isConfigured: !!(config.moss.projectId && config.moss.projectKey),

  async retrieve(query: string, opts?: { k?: number; index?: string }): Promise<MossHit[]> {
    if (!this.isConfigured) throw new Error("Moss not configured (see SETUP.md §4)");

    const index = opts?.index ?? CLINICAL_INDEX;
    const client = await getClient();

    if (!loaded.has(index)) {
      await client.loadIndex(index);
      loaded.add(index);
    }

    const res = await client.query(index, query, { topK: opts?.k ?? 5 });
    return res.docs.map((d) => ({
      text: d.text,
      score: d.score,
      source: d.metadata?.source,
    }));
  },

  /** Build or rebuild an index. `createIndex` throws if the name is taken, so drop it first. */
  async buildIndex(
    index: string,
    docs: { id: string; text: string; metadata?: Record<string, string> }[],
  ): Promise<void> {
    if (!this.isConfigured) throw new Error("Moss not configured (see SETUP.md §4)");
    const client = await getClient();
    await client.deleteIndex(index).catch(() => undefined);
    await client.createIndex(index, docs);
    await client.loadIndex(index);
    loaded.add(index);
  },

  async listIndexes(): Promise<{ name: string; docCount: number }[]> {
    if (!this.isConfigured) throw new Error("Moss not configured (see SETUP.md §4)");
    return (await getClient()).listIndexes();
  },
};
