import { useMutation, useQueryClient } from '@tanstack/react-query'
import { scanImageFn } from '@/api/scan.functions'
import { toastManager } from '@/components/ui/toast'
import { keys, scanResultQuery } from '@/lib/queries'

/**
 * Scans one image by id. When the scan is done, the result of that image and the list badges are
 * updated. The status is refreshed when the scan starts and ends, so the scanning state shows at once.
 * Callbacks are set on the hook, so they run even when the dialog that started the scan has closed.
 */
export function useScanImage() {
  const queryClient = useQueryClient()
  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: [...keys.scans, 'status'] })
  return useMutation({
    mutationFn: (id: string) => scanImageFn({ data: { id } }),
    onMutate: () => {
      void refreshStatus()
    },
    onSuccess: (result) => {
      queryClient.setQueryData(scanResultQuery(result.imageId).queryKey, result)
      void queryClient.invalidateQueries({ queryKey: [...keys.scans, 'summaries'] })
    },
    onError: (err: unknown) => {
      toastManager.add({
        type: 'error',
        title: 'Could not scan the image',
        description: err instanceof Error ? err.message : 'Unknown error.',
      })
    },
    onSettled: () => {
      void refreshStatus()
    },
  })
}
