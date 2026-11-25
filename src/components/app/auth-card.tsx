import type { ReactNode } from 'react'
import { CircleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card } from '@/components/ui/card'
import { Logo } from './logo'

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex justify-center">
          <Logo />
        </div>
        <Card className="p-6 sm:p-7">
          <div className="flex flex-col gap-1.5">
            <h1 className="font-heading font-semibold text-xl tracking-tight">{title}</h1>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
          <div className="mt-6">{children}</div>
        </Card>
      </div>
    </main>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Alert variant="error">
      <CircleAlertIcon />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
