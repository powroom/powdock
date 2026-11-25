import { describe, expect, test } from 'bun:test'
import {
  closeReason,
  execCommand,
  exitEvent,
  errorEvent,
  isSameOrigin,
  parseControlMessage,
  parseServerEvent,
  parseShellList,
  parseTerminalParams,
  preferredShell,
  readyEvent,
  startErrorText,
} from './terminal-protocol'

describe('parseTerminalParams', () => {
  test('takes the shell and size from the query', () => {
    expect(parseTerminalParams(new URLSearchParams('shell=zsh&cols=120&rows=40'))).toEqual({
      shell: 'zsh',
      cols: 120,
      rows: 40,
    })
  })

  test('uses sh and 80x24 when the query is empty', () => {
    expect(parseTerminalParams(new URLSearchParams(''))).toEqual({ shell: 'sh', cols: 80, rows: 24 })
  })

  test('refuses a shell that is not in the list', () => {
    expect(parseTerminalParams(new URLSearchParams('shell=/bin/ash'))).toHaveProperty('error')
    expect(parseTerminalParams(new URLSearchParams('shell=/bin/bash'))).toHaveProperty('error')
    expect(parseTerminalParams(new URLSearchParams('shell=auto'))).toHaveProperty('error')
  })

  test('keeps cols and rows inside their ranges', () => {
    expect(parseTerminalParams(new URLSearchParams('cols=10&rows=5'))).toEqual({ shell: 'sh', cols: 10, rows: 5 })
    expect(parseTerminalParams(new URLSearchParams('cols=500&rows=200'))).toEqual({
      shell: 'sh',
      cols: 500,
      rows: 200,
    })
    expect(parseTerminalParams(new URLSearchParams('cols=9'))).toHaveProperty('error')
    expect(parseTerminalParams(new URLSearchParams('cols=501'))).toHaveProperty('error')
    expect(parseTerminalParams(new URLSearchParams('rows=4'))).toHaveProperty('error')
    expect(parseTerminalParams(new URLSearchParams('rows=201'))).toHaveProperty('error')
  })

  test('refuses size values that are not whole numbers', () => {
    expect(parseTerminalParams(new URLSearchParams('cols=80.5'))).toHaveProperty('error')
    expect(parseTerminalParams(new URLSearchParams('cols=-80'))).toHaveProperty('error')
    expect(parseTerminalParams(new URLSearchParams('rows=abc'))).toHaveProperty('error')
  })
})

describe('execCommand', () => {
  test('runs the shell by its name, which Docker looks up on the PATH', () => {
    expect(execCommand('zsh')).toEqual(['zsh'])
    expect(execCommand('sh')).toEqual(['sh'])
  })
})

describe('parseShellList', () => {
  test('keeps the known shells in list order, without repeats', () => {
    expect(parseShellList('zsh\nbash\nbash\nsh\n')).toEqual(['bash', 'zsh', 'sh'])
  })

  test('trims lines and ignores anything that is not a known shell', () => {
    expect(parseShellList('  fish \r\n/usr/bin/ksh\n\n')).toEqual(['fish'])
  })

  test('returns an empty list for empty output', () => {
    expect(parseShellList('')).toEqual([])
  })
})

describe('preferredShell', () => {
  test('picks bash when there is one, else the first shell', () => {
    expect(preferredShell(['zsh', 'bash', 'sh'])).toBe('bash')
    expect(preferredShell(['fish', 'sh'])).toBe('fish')
  })

  test('returns null when there are no shells', () => {
    expect(preferredShell([])).toBeNull()
  })
})

describe('startErrorText', () => {
  test('names the shell when Docker cannot find it', () => {
    expect(startErrorText('stat /bin/zsh: no such file or directory', 'zsh')).toBe(
      'zsh is not installed in this container.',
    )
    expect(startErrorText('exec: "zsh": executable file not found in $PATH', 'zsh')).toBe(
      'zsh is not installed in this container.',
    )
  })

  test('keeps any other message', () => {
    expect(startErrorText('Docker returned HTTP 500.', 'bash')).toBe('Docker returned HTTP 500.')
  })
})

describe('parseControlMessage', () => {
  test('reads a resize message', () => {
    expect(parseControlMessage('{"type":"resize","cols":100,"rows":30}')).toEqual({
      type: 'resize',
      cols: 100,
      rows: 30,
    })
  })

  test('ignores text that is not a control message', () => {
    expect(parseControlMessage('ls -la')).toBeNull()
    expect(parseControlMessage('"just a string"')).toBeNull()
    expect(parseControlMessage('{"type":"other"}')).toBeNull()
  })

  test('rejects resize values out of range or not whole', () => {
    expect(parseControlMessage('{"type":"resize","cols":5,"rows":30}')).toBeNull()
    expect(parseControlMessage('{"type":"resize","cols":100,"rows":2.5}')).toBeNull()
    expect(parseControlMessage('{"type":"resize","cols":"100","rows":30}')).toBeNull()
  })
})

describe('server events', () => {
  test('round trip the ready, exit and error events', () => {
    expect(parseServerEvent(readyEvent())).toEqual({ type: 'ready' })
    expect(parseServerEvent(exitEvent(0))).toEqual({ type: 'exit', code: 0 })
    expect(parseServerEvent(exitEvent(null))).toEqual({ type: 'exit', code: null })
    expect(parseServerEvent(errorEvent('no shell'))).toEqual({ type: 'error', message: 'no shell' })
  })

  test('returns null for anything else', () => {
    expect(parseServerEvent('not json')).toBeNull()
    expect(parseServerEvent('{"type":"error"}')).toBeNull()
  })
})

describe('closeReason', () => {
  test('keeps short ASCII text as it is', () => {
    expect(closeReason('Too many open terminals')).toBe('Too many open terminals')
  })

  test('cuts long text and replaces non-ASCII characters, so it fits in a close frame', () => {
    const reason = closeReason(`${'é'.repeat(300)}`)
    expect(reason.length).toBeLessThanOrEqual(120)
    expect(new TextEncoder().encode(reason).length).toBeLessThanOrEqual(123)
  })
})

describe('isSameOrigin', () => {
  test('accepts an Origin with the same host and port as the Host header', () => {
    expect(isSameOrigin('http://127.0.0.1:3434', '127.0.0.1:3434')).toBe(true)
    expect(isSameOrigin('http://LOCALHOST:3434', 'localhost:3434')).toBe(true)
  })

  test('refuses another site, another port, a missing or an unreadable Origin', () => {
    expect(isSameOrigin('https://evil.example', '127.0.0.1:3434')).toBe(false)
    expect(isSameOrigin('http://127.0.0.1:3000', '127.0.0.1:3434')).toBe(false)
    expect(isSameOrigin(null, '127.0.0.1:3434')).toBe(false)
    expect(isSameOrigin('null', '127.0.0.1:3434')).toBe(false)
    expect(isSameOrigin('http://127.0.0.1:3434', null)).toBe(false)
  })
})
