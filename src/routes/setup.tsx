import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { AuthCard, FormError } from '@/components/app/auth-card'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { completeSetupFn } from '@/api/session.functions'
import { safeRedirect, validateRedirectSearch } from '@/lib/redirect'

const MIN_PASSWORD = 8

export const Route = createFileRoute('/setup')({
  validateSearch: validateRedirectSearch,
  head: () => ({ meta: [{ title: 'Set up · pow/dock' }] }),
  component: SetupPage,
})

function SetupPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const setup = useMutation({
    mutationFn: () => completeSetupFn({ data: { username: username.trim(), password } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth'] })
      router.history.push(safeRedirect(redirect))
    },
    onError: (err) => setError(err.message),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return setError('Enter a username.')
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the password.`)
    if (password !== confirm) return setError('The two passwords do not match.')
    setError(null)
    setup.mutate()
  }

  return (
    <AuthCard
      description="This account signs you in to pow/dock. Anyone who signs in can control Docker on this machine."
      title="Create your admin account"
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor="setup-username">Username</FieldLabel>
          <Input
            autoCapitalize="none"
            autoComplete="username"
            id="setup-username"
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            value={username}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-password">Password</FieldLabel>
          <Input
            autoComplete="new-password"
            id="setup-password"
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            value={password}
          />
          <FieldDescription>At least {MIN_PASSWORD} characters.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="setup-confirm">Confirm password</FieldLabel>
          <Input
            autoComplete="new-password"
            id="setup-confirm"
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            value={confirm}
          />
        </Field>
        <FormError message={error} />
        <Button loading={setup.isPending} type="submit">
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
