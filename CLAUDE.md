# Hackathon Rules for Agent

This is a YC hackathon project (`porto-novo`, repo `menduque/YC-Hackaton`). Time is the
scarce resource. These rules exist so future sessions don't re-litigate the same defaults
or block on clarifying questions that don't actually need to be asked.

## Bias to action

- Default to the fastest, lightest-weight reasonable interpretation of a request and
  proceed. State the assumption you made in one line and keep moving — don't stop and
  wait for confirmation on it.
- Only pause to ask before acting when the action is genuinely destructive or hard to
  reverse (force-push, deleting data, dropping infra, spending real money, provisioning
  production-grade infra). Standard setup work — installing deps, scaffolding a project,
  cloning a starter template, adding a hosted/cloud integration — does not need a check-in.
- If a decision is close to irreversible, still bias toward the interpretation that keeps
  the most optionality open, note it, and continue rather than blocking.

## Infra preferences

- Prefer hosted/cloud services over self-hosting infrastructure. E.g. use Medplum's
  hosted cloud (app.medplum.com) rather than vendoring their server monorepo and running
  Postgres/Redis/CDR locally, unless explicitly told this needs to be self-hosted.
- Prefer adding SDKs/packages as dependencies in an app scaffolded in this repo over
  cloning a large external monorepo into it.

## Tools already available in this environment

- **gstack** (garrytan/gstack) is installed globally and its skills are already loaded —
  don't reinstall it, just use its skills directly.
- **gbrain** is fully set up (see GBrain Configuration below) — use it directly, no need
  to run setup again.

## GBrain Configuration (configured by /setup-gbrain)
- Mode: local-stdio
- Engine: pglite
- Config file: ~/.gbrain/config.json (mode 0600)
- Setup date: 2026-08-01
- MCP registered: yes (user scope)
- Embedding: deferred — no provider key set (OPENAI_API_KEY / VOYAGE_API_KEY /
  ZEROENTROPY_API_KEY). Keyword search works now; run `gbrain embed --stale` after
  adding a key to enable semantic search.
- Artifacts sync: off
- Current repo policy: read-write
