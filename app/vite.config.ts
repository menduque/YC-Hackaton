import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = path.resolve(import.meta.dirname, '..')

/** Read repo-root .env without pulling in a dependency. */
function rootEnv(): Record<string, string> {
  const file = path.join(repoRoot, '.env')
  if (!fs.existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

/**
 * Dev-only proxy for Stedi eligibility checks.
 *
 * The Stedi API key must never reach the browser bundle, so the app POSTs to
 * `/api/stedi/eligibility` and this middleware forwards it with the key from
 * the repo-root `.env`. In production you'd replace this with a real backend
 * (or a Medplum Bot).
 */
function stediProxy(): Plugin {
  return {
    name: 'stedi-eligibility-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/stedi/eligibility', (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { message: 'POST only' })
          return
        }

        const apiKey = rootEnv().STEDI_API_KEY ?? process.env.STEDI_API_KEY
        if (!apiKey) {
          sendJson(res, 500, { message: 'STEDI_API_KEY missing from repo-root .env' })
          return
        }
        if (!apiKey.startsWith('test_')) {
          sendJson(res, 500, {
            message: 'Refusing to proxy: STEDI_API_KEY is not a test-mode key',
          })
          return
        }

        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', async () => {
          try {
            const upstream = await fetch(
              'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3',
              {
                method: 'POST',
                headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
                body: Buffer.concat(chunks).toString('utf8'),
              }
            )
            const body = await upstream.text()
            res.statusCode = upstream.status
            res.setHeader('content-type', 'application/json')
            res.end(body)
          } catch (err) {
            sendJson(res, 502, { message: String(err) })
          }
        })
      })
    },
  }
}

/**
 * Dev-only Moss endpoints.
 *
 * `@moss-dev/moss` pulls in native Node addons via `@moss-dev/moss-core`, so it
 * can't run in the browser. It runs here instead; the browser hits
 * `/api/moss/index` and `/api/moss/query`.
 */
function mossApi(): Plugin {
  // Lazily constructed so a missing key doesn't break `vite dev` startup.
  let clientPromise: Promise<{
    createIndex: (n: string, d: unknown[]) => Promise<unknown>
    deleteIndex: (n: string) => Promise<boolean>
    loadIndex: (n: string) => Promise<string>
    query: (n: string, q: string, o?: { topK?: number }) => Promise<unknown>
  }> | undefined

  function getClient() {
    if (!clientPromise) {
      const env = rootEnv()
      const projectId = env.MOSS_PROJECT_ID ?? process.env.MOSS_PROJECT_ID
      const projectKey = env.MOSS_PROJECT_KEY ?? process.env.MOSS_PROJECT_KEY
      if (!projectId || !projectKey) {
        return Promise.reject(
          new Error('MOSS_PROJECT_ID / MOSS_PROJECT_KEY missing from repo-root .env')
        )
      }
      // Loaded via a non-literal specifier on purpose: `@moss-dev/moss`'s
      // shipped types reference a tsconfig.json that isn't published, which
      // breaks `tsc` under `module: nodenext` (TS5083). The runtime import is
      // unaffected.
      const specifier = '@moss-dev/moss'
      clientPromise = import(/* @vite-ignore */ specifier).then(
        (m) => new m.MossClient(projectId, projectKey) as never
      )
    }
    return clientPromise
  }

  // Indexes that have been pulled into memory this process, so `query` stays local.
  const loaded = new Set<string>()

  return {
    name: 'moss-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/moss/index', (req, res) => {
        void (async () => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { message: 'POST only' })
            return
          }
          try {
            const { indexName, docs } = (await readJsonBody(req)) as {
              indexName: string
              docs: unknown[]
            }
            if (!indexName || !docs?.length) {
              sendJson(res, 400, { message: 'indexName and a non-empty docs array are required' })
              return
            }
            const client = await getClient()
            // Rebuild from scratch — createIndex throws if the name is taken.
            await client.deleteIndex(indexName).catch(() => undefined)
            await client.createIndex(indexName, docs)
            await client.loadIndex(indexName)
            loaded.add(indexName)
            sendJson(res, 200, { indexName, docCount: docs.length })
          } catch (err) {
            sendJson(res, 500, { message: err instanceof Error ? err.message : String(err) })
          }
        })()
      })

      server.middlewares.use('/api/moss/query', (req, res) => {
        void (async () => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { message: 'POST only' })
            return
          }
          try {
            const { indexName, query, topK } = (await readJsonBody(req)) as {
              indexName: string
              query: string
              topK?: number
            }
            if (!indexName || !query) {
              sendJson(res, 400, { message: 'indexName and query are required' })
              return
            }
            const client = await getClient()
            if (!loaded.has(indexName)) {
              await client.loadIndex(indexName)
              loaded.add(indexName)
            }
            sendJson(res, 200, await client.query(indexName, query, { topK: topK ?? 5 }))
          } catch (err) {
            sendJson(res, 500, { message: err instanceof Error ? err.message : String(err) })
          }
        })()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stediProxy(), mossApi()],
  server: {
    fs: {
      // shared/stedi/* lives above this app root; without this Vite's dev
      // server refuses to serve it.
      allow: [repoRoot],
    },
  },
  // @medplum/react@5.1.27 ships CSS with an unresolved `$mantine-breakpoint-xs`
  // SCSS-style variable inside a media query, which lightningcss (Vite's default
  // minifier) rejects as invalid. Disable CSS minification to work around it.
  build: {
    cssMinify: false,
  },
})
