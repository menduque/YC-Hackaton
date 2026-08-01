import { useMedplumProfile } from '@medplum/react-hooks'
import { Loading, SignInForm } from '@medplum/react'
import { useMedplum } from '@medplum/react-hooks'
import { Button, Stack, Title } from '@mantine/core'

function App() {
  const medplum = useMedplum()
  const profile = useMedplumProfile()

  if (medplum.isLoading()) {
    return <Loading />
  }

  if (!profile) {
    return (
      <SignInForm
        onSuccess={() => undefined}
        projectId={import.meta.env.VITE_MEDPLUM_PROJECT_ID}
      >
        <Title order={2}>Sign in to Medplum</Title>
      </SignInForm>
    )
  }

  return (
    <Stack p="xl">
      <Title order={2}>Signed in as {profile.name?.[0]?.text ?? profile.id}</Title>
      <Button onClick={() => medplum.signOut()} w="fit-content">
        Sign out
      </Button>
    </Stack>
  )
}

export default App
