import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { trivyArgs, trivyCacheDir } from './scan.server'

const IMAGE = 'sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499'

describe('trivyArgs', () => {
  test('the scan command, one argv entry per word, with the image id last', () => {
    expect(trivyArgs(IMAGE)).toEqual([
      'image',
      '--quiet',
      '--format',
      'json',
      '--scanners',
      'vuln',
      '--timeout',
      '10m',
      '--image-src',
      'docker',
      IMAGE,
    ])
  })
})

describe('trivyCacheDir', () => {
  test('uses TRIVY_CACHE_DIR when it is set', () => {
    const saved = process.env.TRIVY_CACHE_DIR
    process.env.TRIVY_CACHE_DIR = '/srv/trivy-cache'
    try {
      expect(trivyCacheDir()).toBe('/srv/trivy-cache')
    } finally {
      if (saved === undefined) delete process.env.TRIVY_CACHE_DIR
      else process.env.TRIVY_CACHE_DIR = saved
    }
  })

  test('otherwise the trivy folder under the cache folder', () => {
    const saved = process.env.TRIVY_CACHE_DIR
    const savedXdg = process.env.XDG_CACHE_HOME
    delete process.env.TRIVY_CACHE_DIR
    process.env.XDG_CACHE_HOME = '/var/cache/custom'
    try {
      expect(trivyCacheDir()).toBe(path.join('/var/cache/custom', 'trivy'))
    } finally {
      if (saved !== undefined) process.env.TRIVY_CACHE_DIR = saved
      if (savedXdg === undefined) delete process.env.XDG_CACHE_HOME
      else process.env.XDG_CACHE_HOME = savedXdg
    }
  })
})
