// A small store with the subset of zustand's API that pow/dock uses: `create<T>()(initializer)`,
// the `persist` middleware on localStorage, and hooks built on useSyncExternalStore.
// Semantics follow zustand 5: set shallow-merges objects, a set that changes nothing is ignored,
// listeners get (state, previousState), and the persisted value is the saved part of the state as JSON.
import { useRef, useSyncExternalStore } from 'react'

type SetState<T> = (partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => void

type GetState<T> = () => T

type Listener<T> = (state: T, previousState: T) => void

interface StoreApi<T> {
  setState: SetState<T>
  getState: GetState<T>
  getInitialState: GetState<T>
  subscribe: (listener: Listener<T>) => () => void
}

type StateCreator<T> = (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T

interface StoreHook<T> extends StoreApi<T> {
  <U = T>(selector?: (state: T) => U, equalityFn?: (a: U, b: U) => boolean): U
}

/** Synchronous string storage, the same shape as the Web Storage API. */
export interface StateStorage {
  getItem: (name: string) => string | null
  setItem: (name: string, value: string) => void
}

interface PersistOptions {
  name: string
  /** default: localStorage (a missing or throwing localStorage just means nothing is persisted) */
  storage?: StateStorage
}

function createStoreApi<T>(createState: StateCreator<T>): StoreApi<T> {
  let state: T
  let initialState: T
  const listeners = new Set<Listener<T>>()

  const setState: SetState<T> = (partial, replace) => {
    const next = typeof partial === 'function' ? (partial as (s: T) => T | Partial<T>)(state) : partial
    if (Object.is(next, state)) return
    const previous = state
    const whole = replace ?? (typeof next !== 'object' || next === null)
    state = whole ? (next as T) : Object.assign({}, state, next)
    listeners.forEach((listener) => listener(state, previous))
  }
  const getState = () => state
  const subscribe = (listener: Listener<T>) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const getInitialState = () => initialState
  const api: StoreApi<T> = { setState, getState, getInitialState, subscribe }
  initialState = createState(setState, getState, api)
  state = initialState
  return api
}

/**
 * The persist middleware. Hydrates synchronously when the store is created (on the client), so
 * the first client render already has the saved state. The server renders the initial state, and
 * the hook's server snapshot is the initial state too, as in zustand.
 */
export function persist<T>(initializer: StateCreator<T>, options: PersistOptions): StateCreator<T> {
  return (set, get, api) => {
    const storage = options.storage ?? localStorageStorage

    const save = () => {
      try {
        storage.setItem(options.name, JSON.stringify(get()))
      } catch (error) {
        console.warn(`[persist] could not save "${options.name}"`, error)
      }
    }

    // zustand's api: setState and set both save after the change
    const savedSetState = api.setState
    api.setState = (partial, replace) => {
      savedSetState(partial, replace)
      save()
    }
    const configResult = initializer(
      (partial, replace) => {
        set(partial, replace)
        save()
      },
      get,
      api,
    )
    api.getInitialState = () => configResult

    // Before the store exists, get() is undefined, so the initializer's result stands in for it.
    try {
      const raw = storage.getItem(options.name)
      if (raw !== null) set({ ...(get() ?? configResult), ...JSON.parse(raw) }, true)
    } catch {
      // a corrupt entry leaves the defaults in place, and the next change overwrites it
    }
    return get() ?? configResult
  }
}

/** localStorage, read only in the browser: on the server there is no storage and nothing is saved. */
function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    // access can throw when site data is blocked
    return null
  }
}

const localStorageStorage: StateStorage = {
  getItem: (name) => browserLocalStorage()?.getItem(name) ?? null,
  setItem: (name, value) => browserLocalStorage()?.setItem(name, value),
}

interface SelectionCache<T, U> {
  state: T
  select: (state: T) => U
  value: U
}

/**
 * Creates a store. Usage matches zustand: `const useStore = create<State>()((set) => ({ ... }))`.
 * The hook takes a selector (default: the whole state) and an optional equality function. The
 * selection is cached per state, so a selector that builds a new object does not loop; with an
 * equality function, an equal new selection keeps the old reference.
 */
export function create<T>() {
  return (initializer: StateCreator<T>): StoreHook<T> => {
    const api = createStoreApi(initializer)

    const useBoundStore = <U = T>(select?: (state: T) => U, equalityFn?: (a: U, b: U) => boolean): U => {
      const pick = (select ?? ((s: T) => s as unknown as U)) as (state: T) => U
      const cache = useRef<SelectionCache<T, U> | null>(null)
      const read = (state: T): U => {
        const hit = cache.current
        if (hit && hit.state === state && hit.select === pick) return hit.value
        const next = pick(state)
        const value = hit && equalityFn?.(hit.value, next) ? hit.value : next
        cache.current = { state, select: pick, value }
        return value
      }
      return useSyncExternalStore(
        api.subscribe,
        () => read(api.getState()),
        () => read(api.getInitialState()),
      )
    }

    return Object.assign(useBoundStore, api) as StoreHook<T>
  }
}
