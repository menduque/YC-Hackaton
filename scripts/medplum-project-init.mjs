#!/usr/bin/env node
// Provision a new Medplum project on the hosted cloud via the `Project/$init`
// FHIR operation — https://www.medplum.com/docs/api/fhir/operations/project-init
//
//   npx medplum login                              # once, opens a browser
//   npm run project:init -- "Oido AI"              # create the project
//   npm run project:init -- "Oido AI" --write-env  # ...and point app/.env at it
//
// `$init` creates the Project, a ClientApplication, and the owner's
// ProjectMembership in one call. It only returns the Project; the operation
// definition declares a single `return` output of type Project
// (packages/server/src/fhir/operations/projectinit.ts).
//
// Auth: any authenticated user can call it. The owner defaults to the User on
// the current access token, and that User must not already belong to a Project
// (a normal medplum.com signup is a global User, so this is fine).

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = process.env.MEDPLUM_BASE_URL ?? 'https://api.medplum.com/'

const args = process.argv.slice(2)
const writeEnv = args.includes('--write-env')
// npm strips the quotes, so `-- "Oido AI"` arrives as two argv entries.
const name = args.filter((a) => !a.startsWith('--')).join(' ')

if (!name) {
  console.error('Usage: npm run project:init -- "<Project name>" [--write-env]')
  process.exit(1)
}

function getAccessToken() {
  if (process.env.MEDPLUM_ACCESS_TOKEN) return process.env.MEDPLUM_ACCESS_TOKEN
  try {
    // `medplum token` refreshes from ~/.medplum/<profile>.json and prints the
    // bare access token.
    return execFileSync('npx', ['medplum', 'token'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    console.error('Not logged in. Run:  npx medplum login')
    console.error('(or set MEDPLUM_ACCESS_TOKEN)')
    process.exit(1)
  }
}

const token = getAccessToken()

const res = await fetch(new URL('fhir/R4/Project/$init', BASE_URL), {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/fhir+json',
  },
  body: JSON.stringify({
    resourceType: 'Parameters',
    parameter: [{ name: 'name', valueString: name }],
  }),
})

const body = await res.json()

if (!res.ok) {
  console.error(`Project/$init failed [${res.status}]`)
  console.error(JSON.stringify(body, null, 2))
  process.exit(1)
}

// $init returns either the Project directly or wrapped in Parameters.
const project =
  body.resourceType === 'Project'
    ? body
    : body.parameter?.find((p) => p.name === 'return')?.resource

if (!project?.id) {
  console.error('Unexpected response:')
  console.error(JSON.stringify(body, null, 2))
  process.exit(1)
}

console.log(`Created Project "${project.name}"`)
console.log(`  id     ${project.id}`)
console.log(`  owner  ${project.owner?.reference ?? '(none)'}`)

if (writeEnv) {
  const envPath = path.join(root, 'app/.env')
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''
  const updated = current.includes('VITE_MEDPLUM_PROJECT_ID=')
    ? current.replace(/^VITE_MEDPLUM_PROJECT_ID=.*$/m, `VITE_MEDPLUM_PROJECT_ID=${project.id}`)
    : `${current}\nVITE_MEDPLUM_PROJECT_ID=${project.id}\n`
  fs.writeFileSync(envPath, updated)
  console.log(`\nWrote VITE_MEDPLUM_PROJECT_ID to app/.env`)
}

console.log(`\nSwitch the CLI to it:  npx medplum project switch ${project.id}`)
