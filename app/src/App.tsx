import { useState } from 'react'
import { useMedplum, useMedplumProfile } from '@medplum/react-hooks'
import { Loading, SignInForm } from '@medplum/react'
import { Button, Group, Modal, Stack, Text, Title } from '@mantine/core'
import { EligibilityDemo } from './pages/EligibilityDemo'

function App() {
  const medplum = useMedplum()
  const profile = useMedplumProfile()
  const [signInOpen, setSignInOpen] = useState(false)

  if (medplum.isLoading()) {
    return <Loading />
  }

  return (
    <Stack gap={0}>
      <Group justify="space-between" p="md" style={{ borderBottom: '1px solid #e9ecef' }}>
        <Text fw={600}>Stedi × Medplum</Text>
        {profile ? (
          <Group gap="sm">
            <Text size="sm" c="dimmed">
              {profile.name?.[0]?.text ?? profile.id}
            </Text>
            <Button variant="subtle" size="xs" onClick={() => medplum.signOut()}>
              Sign out
            </Button>
          </Group>
        ) : (
          <Button size="xs" variant="light" onClick={() => setSignInOpen(true)}>
            Sign in to Medplum
          </Button>
        )}
      </Group>

      {/* The Stedi side runs without Medplum — sign-in only gates persistence. */}
      <EligibilityDemo onSignInRequired={() => setSignInOpen(true)} />

      <Modal opened={signInOpen} onClose={() => setSignInOpen(false)} withCloseButton={false}>
        <SignInForm
          onSuccess={() => setSignInOpen(false)}
          projectId={import.meta.env.VITE_MEDPLUM_PROJECT_ID}
        >
          <Title order={3}>Sign in to Medplum</Title>
        </SignInForm>
      </Modal>
    </Stack>
  )
}

export default App
