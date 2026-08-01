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

/**
 * Retrieval sin Moss: overlap de palabras contra los mismos documentos que se
 * habrian indexado. Es notoriamente peor — cuenta palabras, no entiende — pero
 * mantiene la demo en pie cuando no hay keys, en vez de dejar al agente mudo.
 */
export function matchPorPalabras(
  docs: { text: string; metadata?: Record<string, string> }[],
  pregunta: string,
  k = 4,
): MossHit[] {
  const terminos = tokens(pregunta);
  if (!terminos.length) return [];
  return docs
    .map((d) => {
      const texto = tokens(d.text);
      return {
        text: d.text,
        score: terminos.filter((t) => texto.includes(t)).length / terminos.length,
        source: d.metadata?.source ?? d.metadata?.kind,
      };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

const PALABRAS_VACIAS = new Set([
  "que", "con", "por", "para", "una", "uno", "los", "las", "del", "mas", "the", "and", "for", "you",
  "your", "was", "are", "did", "have", "has", "what", "when", "about", "last", "time", "can", "take",
]);

function tokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !PALABRAS_VACIAS.has(t));
}
