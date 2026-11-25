import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { create, persist, type StateStorage } from './create-store'

interface Counter {
  count: number
  items: string[]
  label: string
  inc: () => void
  add: (item: string) => void
  setLabel: (label: string) => void
}

function counterInit(set: (partial: Partial<Counter>) => void, get: () => Counter): Counter {
  return {
    count: 0,
    items: [],
    label: 'start',
    inc: () => set({ count: get().count + 1 }),
    add: (item) => set({ items: [...get().items, item] }),
    setLabel: (label) => set({ label }),
  }
}

/** A string storage that keeps what was written, so tests can read the saved format. */
function fakeStorage(initial?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(initial ?? {}))
  const storage: StateStorage = {
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, value) => {
      data.set(name, value)
    },
  }
  return { storage, data }
}

describe('create: set, get and subscribe', () => {
  test('object set merges into the state', () => {
    const useStore = create<Counter>()(counterInit)
    useStore.getState().setLabel('next')
    expect(useStore.getState().label).toBe('next')
    expect(useStore.getState().count).toBe(0)
    expect(typeof useStore.getState().inc).toBe('function')
  })

  test('function updater receives the current state', () => {
    const useStore = create<Counter>()(counterInit)
    useStore.getState().inc()
    useStore.setState((s) => ({ count: s.count + 10 }))
    expect(useStore.getState().count).toBe(11)
  })

  test('replace true replaces the whole state', () => {
    const useStore = create<Counter>()(counterInit)
    useStore.setState({ count: 5 } as Counter, true)
    expect(useStore.getState()).toEqual({ count: 5 } as Counter)
  })

  test('a non-object set replaces the state', () => {
    const useStore = create<number>()(() => 1)
    useStore.setState(2)
    expect(useStore.getState()).toBe(2)
  })

  test('setting the same object does nothing', () => {
    const useStore = create<Counter>()(counterInit)
    const calls: number[] = []
    useStore.subscribe(() => calls.push(1))
    const same = useStore.getState()
    useStore.setState(same)
    expect(calls).toEqual([])
  })

  test('listeners get the new and previous state', () => {
    const useStore = create<Counter>()(counterInit)
    const seen: Array<[number, number]> = []
    useStore.subscribe((state, prev) => seen.push([state.count, prev.count]))
    useStore.getState().inc()
    useStore.getState().inc()
    expect(seen).toEqual([
      [1, 0],
      [2, 1],
    ])
  })

  test('unsubscribe stops the listener', () => {
    const useStore = create<Counter>()(counterInit)
    let calls = 0
    const unsubscribe = useStore.subscribe(() => calls++)
    useStore.getState().inc()
    unsubscribe()
    useStore.getState().inc()
    expect(calls).toBe(1)
    expect(useStore.getState().count).toBe(2)
  })

  test('getInitialState keeps the first state', () => {
    const useStore = create<Counter>()(counterInit)
    useStore.getState().inc()
    expect(useStore.getInitialState().count).toBe(0)
  })
})

describe('hook selection', () => {
  function Label({ useStore }: { useStore: { (s: (s: Counter) => string): string } }) {
    return createElement(
      'span',
      null,
      useStore((s) => s.label),
    )
  }

  test('the server render uses the selector on the initial state', () => {
    const useStore = create<Counter>()(counterInit)
    useStore.getState().setLabel('changed')
    const html = renderToString(createElement(Label, { useStore }))
    expect(html).toBe('<span>start</span>')
  })

  test('a selector that builds a new object renders without looping', () => {
    const useStore = create<Counter>()(counterInit)
    function Pair() {
      const pair = useStore((s) => ({ count: s.count, label: s.label }))
      return createElement('span', null, `${pair.count}-${pair.label}`)
    }
    expect(renderToString(createElement(Pair))).toBe('<span>0-start</span>')
  })
})

describe('persist', () => {
  test('saves the state as JSON after each set, without functions', () => {
    const { storage, data } = fakeStorage()
    const useStore = create<Counter>()(persist(counterInit, { name: 'counter', storage }))
    useStore.getState().setLabel('saved')
    const raw = JSON.parse(data.get('counter') ?? 'null')
    expect(raw.label).toBe('saved')
    expect(raw.count).toBe(0)
    expect(typeof raw.inc).toBe('undefined')
  })

  test('a fresh store hydrates from what the first one saved', () => {
    const { storage } = fakeStorage()
    const first = create<Counter>()(persist(counterInit, { name: 'counter', storage }))
    first.getState().inc()
    first.getState().add('a')
    const second = create<Counter>()(persist(counterInit, { name: 'counter', storage }))
    expect(second.getState().count).toBe(1)
    expect(second.getState().items).toEqual(['a'])
  })

  test('saved keys are merged over the defaults', () => {
    const { storage } = fakeStorage({ counter: '{"count":3}' })
    const useStore = create<Counter>()(persist(counterInit, { name: 'counter', storage }))
    expect(useStore.getState().count).toBe(3)
    expect(useStore.getState().label).toBe('start')
  })

  test('corrupt JSON leaves the defaults and does not throw', () => {
    const { storage } = fakeStorage({ counter: '{not json' })
    const useStore = create<Counter>()(persist(counterInit, { name: 'counter', storage }))
    expect(useStore.getState().count).toBe(0)
  })

  test('a storage that throws does not break set or creation', () => {
    const broken: StateStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    const useStore = create<Counter>()(persist(counterInit, { name: 'counter', storage: broken }))
    expect(() => useStore.getState().inc()).not.toThrow()
    expect(useStore.getState().count).toBe(1)
  })
})
