import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { AuthCard, FormError } from '@/components/app/auth-card'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { signInFn } from '@/api/session.functions'
import { safeRedirect, validateRedirectSearch } from '@/lib/redirect'

export const Route = createFileRoute('/login')({
  validateSearch: validateRedirectSearch,
  head: () => ({ meta: [{ title: 'Sign in · pow/dock' }] }),
  component: LoginPage,
})

function LoginPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const login = useMutation({
    mutationFn: () => signInFn({ data: { username: username.trim(), password } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth'] })
      router.history.push(safeRedirect(redirect))
    },
    onError: (err) => setError(err.message),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setError(null)
    login.mutate()
  }

  return (
    <AuthCard description="A light window into Docker on this machine." title="Sign in to pow/dock">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor="login-username">Username</FieldLabel>
          <Input
            autoCapitalize="none"
            autoComplete="username"
            autoFocus
            id="login-username"
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            value={username}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <Input
            autoComplete="current-password"
            id="login-password"
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            value={password}
          />
        </Field>
        <FormError message={error} />
        <Button loading={login.isPending} type="submit">
          Sign in
        </Button>
      </form>
    </AuthCard>
  )
}
