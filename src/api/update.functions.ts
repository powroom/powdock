import { createServerFn } from '@tanstack/react-start'
import type { UpdateInfo } from '@/lib/version'

/** The newest pow/dock release when it is newer than this one (cached on the server, see update-check.server.ts). */
export const updateInfoFn = createServerFn({ method: 'GET' }).handler(async (): Promise<UpdateInfo> => {
  const { getUpdateInfo } = await import('@/server/update-check.server')
  return getUpdateInfo()
})
