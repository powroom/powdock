import { create, persist } from '@/lib/create-store'

/** Settings kept in this browser (localStorage). */
interface AppState {
  /** The newest release the user closed the update notice for. The notice stays hidden for that version. */
  dismissedUpdate: string | null
  setDismissedUpdate: (version: string | null) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      dismissedUpdate: null,
      setDismissedUpdate: (version) => set({ dismissedUpdate: version }),
    }),
    { name: 'powdock-state' },
  ),
)
