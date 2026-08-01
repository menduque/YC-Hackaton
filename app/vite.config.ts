import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // @medplum/react@5.1.27 ships CSS with an unresolved `$mantine-breakpoint-xs`
  // SCSS-style variable inside a media query, which lightningcss (Vite's default
  // minifier) rejects as invalid. Disable CSS minification to work around it.
  build: {
    cssMinify: false,
  },
})
