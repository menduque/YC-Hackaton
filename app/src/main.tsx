import { MedplumClient } from '@medplum/core'
import { MedplumProvider } from '@medplum/react'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'

import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@medplum/react/styles.css'
import './index.css'

const medplum = new MedplumClient({
  baseUrl: import.meta.env.VITE_MEDPLUM_BASE_URL ?? 'https://api.medplum.com/',
  clientId: import.meta.env.VITE_MEDPLUM_CLIENT_ID,
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <MedplumProvider medplum={medplum}>
        <MantineProvider>
          <Notifications />
          <App />
        </MantineProvider>
      </MedplumProvider>
    </BrowserRouter>
  </StrictMode>,
)
