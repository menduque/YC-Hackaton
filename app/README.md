# React + TypeScript + Vite + Medplum

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules,
wired up to [Medplum](https://www.medplum.com)'s hosted FHIR cloud (no self-hosted backend needed).

## Medplum setup

1. Sign up for a free project at [app.medplum.com](https://app.medplum.com).
2. In your project, go to **Clients** and create a new client. Add `http://localhost:5173` as an
   allowed redirect URI (or whatever port `npm run dev` prints).
3. Copy `.env.example` to `.env` and fill in `VITE_MEDPLUM_CLIENT_ID` and `VITE_MEDPLUM_PROJECT_ID`
   from that client.
4. `npm run dev` and sign in.

Note: `vite.config.ts` disables CSS minification (`build.cssMinify: false`) to work around a bug in
`@medplum/react@5.1.27`'s shipped CSS (an unresolved `$mantine-breakpoint-xs` SCSS variable inside a
media query breaks Vite's default lightningcss minifier). Safe to remove once Medplum ships a fix.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
