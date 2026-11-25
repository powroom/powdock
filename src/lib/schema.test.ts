import { describe, expect, test } from 'bun:test'
import { s, toJSONSchema, SchemaError, type Infer, type InferInput } from './schema'

describe('primitive types', () => {
  test('string accepts strings only', () => {
    expect(s.string().parse('x')).toBe('x')
    expect(s.string().safeParse(1).success).toBe(false)
    expect(s.string().safeParse(null).success).toBe(false)
  })

  test('number rejects NaN and the infinities, with their messages', () => {
    expect(s.number().parse(1.5)).toBe(1.5)
    expect(s.number().safeParse(NaN)).toMatchObject({
      success: false,
      error: { issues: [{ message: 'Invalid input: expected number, received NaN' }] },
    })
    expect(s.number().safeParse(Infinity)).toMatchObject({
      success: false,
      error: { issues: [{ message: 'Invalid input: expected number, received Infinity' }] },
    })
    expect(s.number().safeParse('1').success).toBe(false)
  })

  test('boolean and null', () => {
    expect(s.boolean().parse(false)).toBe(false)
    expect(s.boolean().safeParse('false').success).toBe(false)
    expect(s.null().parse(null)).toBeNull()
    expect(s.null().safeParse(undefined).success).toBe(false)
  })

  test('unknown accepts anything', () => {
    expect(s.unknown().parse(undefined)).toBeUndefined()
    expect(s.unknown().parse({ a: 1 })).toEqual({ a: 1 })
  })

  test('literal and enum report the expected values', () => {
    expect(s.literal('all').safeParse('x')).toMatchObject({
      error: { issues: [{ code: 'invalid_value', message: 'Invalid input: expected "all"' }] },
    })
    expect(s.enum(['a']).safeParse('b')).toMatchObject({
      error: { issues: [{ message: 'Invalid input: expected "a"' }] },
    })
    expect(s.enum(['disable', 'require']).safeParse('x')).toMatchObject({
      error: { issues: [{ code: 'invalid_value', message: 'Invalid option: expected one of "disable"|"require"' }] },
    })
    expect(s.enum(['a', 'b']).parse('b')).toBe('b')
  })
})

describe('string checks', () => {
  test('trim runs before length checks', () => {
    expect(s.string().trim().min(2).parse(' ab ')).toBe('ab')
    expect(s.string().trim().min(1).safeParse('   ').success).toBe(false)
  })

  test('length checks count code points, not UTF-16 units', () => {
    expect(s.string().max(2).parse('😀😀')).toBe('😀😀')
    expect(s.string().min(2).safeParse('😀').success).toBe(false)
  })

  test('min and max messages use the usual wording, and custom messages replace them', () => {
    expect(s.string().min(3).safeParse('ab').error?.issues[0]?.message).toBe(
      'Too small: expected string to have >=3 characters',
    )
    expect(s.string().max(3).safeParse('abcd').error?.issues[0]?.message).toBe(
      'Too big: expected string to have <=3 characters',
    )
    expect(s.string().min(1, 'Name is required.').safeParse('').error?.issues[0]?.message).toBe('Name is required.')
  })

  test('regex: default and custom message', () => {
    expect(s.string().regex(/^a+$/).safeParse('b').error?.issues[0]).toEqual({
      code: 'invalid_format',
      path: [],
      message: 'Invalid string: must match pattern /^a+$/',
    })
    expect(s.string().regex(/^a+$/, 'nope').safeParse('b').error?.issues[0]?.message).toBe('nope')
  })

  test('a regex can be reused across parses (no stateful lastIndex)', () => {
    const schema = s.string().regex(/^a+$/g)
    expect(schema.parse('aa')).toBe('aa')
    expect(schema.parse('aa')).toBe('aa')
  })
})

describe('number checks', () => {
  test('int, positive, min and max', () => {
    expect(s.number().int().parse(3)).toBe(3)
    expect(s.number().int().safeParse(1.5).error?.issues[0]?.message).toBe(
      'Invalid input: expected int, received number',
    )
    expect(s.number().int().positive().safeParse(0).error?.issues[0]?.message).toBe(
      'Too small: expected number to be >0',
    )
    expect(s.number().min(1).safeParse(0).error?.issues[0]?.message).toBe('Too small: expected number to be >=1')
    expect(s.number().max(10).safeParse(11).error?.issues[0]?.message).toBe('Too big: expected number to be <=10')
  })

  test('a non-integer aborts the checks after int', () => {
    const issues = s
      .number()
      .int()
      .min(2)
      .safeParse(1.5)
      .error?.issues.map((i) => i.code)
    expect(issues).toEqual(['invalid_type'])
  })

  test('an integer outside the safe range is a bound on int', () => {
    expect(
      s
        .number()
        .int()
        .safeParse(2 ** 53).error?.issues[0],
    ).toEqual({
      code: 'too_big',
      path: [],
      message: 'Too big: expected int to be <=9007199254740991',
    })
    expect(
      s
        .number()
        .int()
        .safeParse(-(2 ** 53)).error?.issues[0]?.message,
    ).toBe('Too small: expected int to be >=-9007199254740991')
  })
})

describe('defaults, optional, nullable, catch', () => {
  test('default applies to undefined only and is not validated', () => {
    expect(s.number().int().min(1).default(22).parse(undefined)).toBe(22)
    expect(s.string().min(3).default('zz').parse(undefined)).toBe('zz')
    expect(s.string().min(3).default('zz').safeParse('a').success).toBe(false)
  })

  test('a default array is a fresh copy for each parse', () => {
    const schema = s.array(s.string()).default([])
    const first = schema.parse(undefined)
    first.push('x')
    expect(schema.parse(undefined)).toEqual([])
  })

  test('optional accepts undefined; nullable accepts null', () => {
    expect(s.string().optional().parse(undefined)).toBeUndefined()
    expect(s.string().nullable().parse(null)).toBeNull()
    expect(s.string().optional().safeParse(null).success).toBe(false)
    expect(s.string().nullable().safeParse(undefined).success).toBe(false)
  })

  test('catch replaces any failure with its value', () => {
    expect(s.number().catch(7).parse('x')).toBe(7)
    expect(s.string().min(3).catch('x').parse('a')).toBe('x')
    expect(s.number().int().min(1).optional().catch(undefined).parse('x')).toBeUndefined()
  })
})

describe('arrays, records and unions', () => {
  test('array checks the length and reports items by index', () => {
    expect(s.array(s.number()).min(1).safeParse([]).error?.issues[0]?.message).toBe(
      'Too small: expected array to have >=1 items',
    )
    expect(s.array(s.number()).safeParse([1, 'x']).error?.issues[0]?.path).toEqual([1])
  })

  test('record of string keys', () => {
    const schema = s.record(s.string(), s.union([s.string(), s.null()]))
    expect(schema.parse({ a: 'x', b: null })).toEqual({ a: 'x', b: null })
    expect(schema.safeParse([]).error?.issues[0]?.message).toBe('Invalid input: expected record, received array')
    expect(schema.safeParse({ a: 1 }).error?.issues[0]).toEqual({
      code: 'invalid_union',
      path: ['a'],
      message: 'Invalid input',
    })
  })

  test('union tries the options in order and returns the first that passes', () => {
    const schema = s.union([s.literal('all'), s.array(s.string()).min(1)])
    expect(schema.parse('all')).toBe('all')
    expect(schema.parse(['a'])).toEqual(['a'])
  })

  test('a union returns the issues of the one option that got past its type check', () => {
    const issue = s.union([s.literal('all'), s.array(s.string()).min(1)]).safeParse([]).error?.issues[0]
    expect(issue).toEqual({ code: 'too_small', path: [], message: 'Too small: expected array to have >=1 items' })
    expect(s.union([s.literal('all'), s.array(s.string())]).safeParse('x').error?.issues).toEqual([
      { code: 'invalid_union', path: [], message: 'Invalid input' },
    ])
  })
})

describe('objects', () => {
  test('unknown keys are stripped by object and rejected by strictObject', () => {
    expect(s.object({ a: s.string() }).parse({ a: 'x', b: 1 })).toEqual({ a: 'x' })
    expect(s.strictObject({ a: s.string() }).safeParse({ a: 'x', b: 1 }).error?.issues[0]).toEqual({
      code: 'unrecognized_keys',
      path: [],
      message: 'Unrecognized key: "b"',
    })
    expect(s.strictObject({ a: s.string() }).safeParse({ a: 'x', b: 1, c: 2 }).error?.issues[0]?.message).toBe(
      'Unrecognized keys: "b", "c"',
    )
  })

  test('every field problem is reported, in shape order', () => {
    const issues = s.object({ a: s.string(), b: s.number() }).safeParse({ b: 'x' }).error?.issues
    expect(issues).toEqual([
      { code: 'invalid_type', path: ['a'], message: 'Invalid input: expected string, received undefined' },
      { code: 'invalid_type', path: ['b'], message: 'Invalid input: expected number, received string' },
    ])
  })

  test('defaults fill absent keys, optional keys stay absent, present undefined keys stay present', () => {
    const schema = s.object({ a: s.string().optional(), b: s.number().default(1) })
    expect(schema.parse({})).toStrictEqual({ b: 1 })
    expect(schema.parse({ a: undefined, b: 2 })).toStrictEqual({ a: undefined, b: 2 })
  })

  test('a non-object input is rejected with its message', () => {
    expect(s.object({}).safeParse(null).error?.issues[0]?.message).toBe('Invalid input: expected object, received null')
    expect(s.object({}).safeParse([]).error?.issues[0]?.message).toBe('Invalid input: expected object, received array')
  })

  test('extend and pick', () => {
    const base = s.object({ id: s.string(), name: s.string(), n: s.number() })
    expect(base.extend({ extra: s.boolean() }).parse({ id: 'a', name: 'b', n: 1, extra: true })).toEqual({
      id: 'a',
      name: 'b',
      n: 1,
      extra: true,
    })
    expect(base.pick({ id: true }).parse({ id: 'a' })).toEqual({ id: 'a' })
  })

  test('object refinements run only when the fields passed their type checks', () => {
    const schema = s.object({ a: s.enum(['x']) }).refine(() => false, 'never')
    expect(schema.safeParse({ a: 'y' }).error?.issues.map((i) => i.code)).toEqual(['invalid_value'])
    expect(schema.safeParse({ a: 'x' }).error?.issues[0]?.message).toBe('never')
  })

  test('superRefine adds issues at a path', () => {
    const schema = s.object({ key: s.string() }).superRefine((v, ctx) => {
      if (!v.key.includes('X')) ctx.addIssue({ code: 'custom', path: ['key'], message: 'needs X' })
    })
    expect(schema.safeParse({ key: 'a' }).error?.issues[0]).toEqual({
      code: 'custom',
      path: ['key'],
      message: 'needs X',
    })
    expect(schema.parse({ key: 'aX' })).toEqual({ key: 'aX' })
  })
})

describe('parse, safeParse and Standard Schema', () => {
  test('parse throws a SchemaError whose message lists the issues', () => {
    const schema = s.object({ port: s.number().int() })
    let caught: unknown
    try {
      schema.parse({ port: 'x' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SchemaError)
    expect((caught as Error).message).toBe('port: Invalid input: expected number, received string')
  })

  test('the root path is shown as (root)', () => {
    expect(() => s.object({}).parse(undefined)).toThrow('(root): Invalid input: expected object, received undefined')
  })

  test('the Standard Schema interface validates and reports issues with messages and paths', () => {
    const schema = s.object({ a: s.string().min(2) })
    const std = schema['~standard']
    expect(std.version).toBe(1)
    expect(std.validate({ a: 'xy' })).toEqual({ value: { a: 'xy' } })
    const failed = std.validate({ a: 'x' }) as { issues: Array<{ code: string; message: string; path?: unknown[] }> }
    expect(failed.issues).toEqual([
      { code: 'too_small', path: ['a'], message: 'Too small: expected string to have >=2 characters' },
    ])
  })

  test('inference types the output and the input', () => {
    const schema = s.object({ name: s.string().trim(), port: s.number().int().default(22), tag: s.string().optional() })
    type Out = Infer<typeof schema>
    type In = InferInput<typeof schema>
    const out: Out = { name: 'x', port: 1 }
    const input: In = { name: 'x' }
    expect(out.port).toBe(1)
    expect(input.name).toBe('x')
  })
})

describe('JSON Schema', () => {
  test('an object lists its required fields and the draft', () => {
    const json = toJSONSchema(s.object({ name: s.string(), port: s.number().int().optional() }))
    expect(json.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(json.type).toBe('object')
    expect(json.required).toEqual(['name'])
  })
})
