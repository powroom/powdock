import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { LogOutIcon, UserIcon } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Section } from '@/components/app/detail-fields'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toastManager } from '@/components/ui/toast'
import { changePasswordFn, signOutFn } from '@/api/account.functions'
import { authStateQuery } from '@/lib/queries'
import { FormError } from './auth-card'

const MIN_PASSWORD = 8

/** Who is signed in, sign out, and the password form. */
export function AccountSettings() {
  const { data: auth } = useQuery(authStateQuery())
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const changePassword = useMutation({
    mutationFn: () => changePasswordFn({ data: { current, next } }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      setError(null)
      toastManager.add({
        type: 'success',
        title: 'Password changed',
        description: 'Other devices and browsers have been signed out.',
      })
    },
    onError: (err) => setError(err.message),
  })

  const signOut = useMutation({
    mutationFn: () => signOutFn(),
    onSuccess: async () => {
      // Forget everything fetched while signed in, then show the sign-in page.
      queryClient.clear()
      await navigate({ to: '/login' })
    },
    onError: (err) => toastManager.add({ type: 'error', title: 'Could not sign out', description: err.message }),
  })

  if (!auth) return null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!current) return setError('Enter your current password.')
    if (next.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the new password.`)
    if (next !== confirm) return setError('The two new passwords do not match.')
    setError(null)
    changePassword.mutate()
  }

  return (
    <>
      <Section title="Signed in">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <UserIcon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground text-xs">Signed in as</div>
            <div className="truncate font-medium">{auth.username}</div>
          </div>
          <Button loading={signOut.isPending} onClick={() => signOut.mutate()} variant="outline">
            <LogOutIcon aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </Section>

      <Section title="Change password">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <p className="text-muted-foreground text-sm">
            Other devices and browsers will be signed out. This one stays signed in.
          </p>
          <Field>
            <FieldLabel htmlFor="account-current">Current password</FieldLabel>
            <Input
              autoComplete="current-password"
              id="account-current"
              onChange={(e) => setCurrent(e.target.value)}
              type="password"
              value={current}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="account-next">New password</FieldLabel>
              <Input
                autoComplete="new-password"
                id="account-next"
                onChange={(e) => setNext(e.target.value)}
                type="password"
                value={next}
              />
              <FieldDescription>At least {MIN_PASSWORD} characters.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="account-confirm">Confirm new password</FieldLabel>
              <Input
                autoComplete="new-password"
                id="account-confirm"
                onChange={(e) => setConfirm(e.target.value)}
                type="password"
                value={confirm}
              />
            </Field>
          </div>
          <FormError message={error} />
          <div>
            <Button loading={changePassword.isPending} type="submit" variant="outline">
              Change password
            </Button>
          </div>
        </form>
      </Section>
    </>
  )
}
