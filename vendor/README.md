# vendor/

Third-party source vendored into this repo so it travels with the checkout and works
offline. Nothing here is ours — don't edit it, and don't expect our changes to survive a
re-vendor.

## medplum

Upstream: https://github.com/medplum/medplum
License: Apache-2.0 (see `medplum/LICENSE.txt`)

| | |
| --- | --- |
| Commit | `59c344c5dbd38eb7a6171846780254b74cb0b275` |
| Date | 2026-08-01 |
| Vendored | 2026-08-01 |
| Size | ~219 MB, 5193 files |

This is the working tree only — the upstream `.git` was excluded, so this is a plain
vendored copy rather than a nested repo or submodule.

`medplum-link` at the repo root is a relative symlink to `vendor/medplum`, which is the
layout [Medplum recommends for AI coding assistants](https://www.medplum.com/docs/building-with-ai-coding-assistants).
Both paths work; `medplum-link/` is the one referenced in `CLAUDE.md`.

The parts worth reading:

- `medplum/packages/` — the actual SDK source (`core`, `react`, `fhirtypes`, `cli`, `server`)
- `medplum/examples/medplum-eligibility-demo` — closest reference for our workflow
- `medplum/packages/definitions/src/fhir/r4/` — the raw FHIR R4 spec data (~52 MB of it)

### Re-vendoring

```bash
git clone --depth 1 https://github.com/medplum/medplum.git /tmp/medplum
rsync -a --delete --exclude='.git/' /tmp/medplum/ vendor/medplum/
# then update the commit hash in this file
```
