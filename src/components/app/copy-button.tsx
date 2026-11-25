import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { ButtonProps } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'
import { showCopyFailed } from '@/components/app/copy-feedback'

/** Copies text and shows "Copied" for a moment. `children` is the idle label. */
export function CopyButton({
  text,
  label = 'Copy',
  size = 'sm',
  variant = 'outline',
  children = 'Copy',
}: {
  text: string
  label?: string
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  children?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    const ok = await copyText(text)
    if (!ok) {
      showCopyFailed()
      return
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Button aria-label={label} onClick={() => void copy()} size={size} variant={variant}>
      {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {copied ? 'Copied' : children}
    </Button>
  )
}
