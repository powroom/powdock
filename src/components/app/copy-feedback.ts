import { toastManager } from '@/components/ui/toast'
import { copyText } from '@/lib/clipboard'

/** Error toast for a copy the browser refused. */
export function showCopyFailed(): void {
  toastManager.add({
    type: 'error',
    title: 'Could not copy',
    description: 'The browser blocked access to the clipboard.',
  })
}

/** Copies text and reports the result in a global toast. */
export async function copyWithToast(text: string, title: string, description?: string): Promise<void> {
  const ok = await copyText(text)
  if (ok) toastManager.add({ type: 'success', title, description, timeout: 2000 })
  else showCopyFailed()
}
