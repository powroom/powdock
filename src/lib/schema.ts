// Validation for pow/dock's server function inputs and any JSON it reads. It covers the part of
// zod 4 the app uses, with the same English messages. Schemas implement Standard Schema v1, so
// TanStack Start's .validator() takes them directly.

/** A problem found while validating. `path` says where, from the value that was validated. */
interface Issue {
  code: string
  path: (string | number)[]
  message: string
}

/** Thrown by parse(). The message lists every issue as "path: message". */
export class SchemaError extends Error {
  readonly issues: Issue[]

  constructor(issues: Issue[]) {
    super(formatIssues(issues))
    this.name = 'SchemaError'
    this.issues = issues
  }
}

type SafeParseResult<O> =
  { success: true; data: O; error?: undefined } | { success: false; data?: undefined; error: SchemaError }

/** The Standard Schema v1 interface (https://standardschema.dev), with types for inference. */
interface StandardSchemaProps<I, O> {
  readonly version: 1
  readonly vendor: string
  readonly validate: (
    value: unknown,
  ) =>
    | { readonly value: O; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<PropertyKey> }> }
  readonly types?: { readonly input: I; readonly output: O }
}

/** The output type of a schema: what its parse returns. */
export type Infer<T> = T extends { readonly _output: infer O } ? O : never
/** The input type of a schema: what it accepts. */
export type InferInput<T> = T extends { readonly _input: infer I } ? I : never

interface RefineContext {
  addIssue(issue: { code?: string; message?: string; path?: (string | number)[] }): void
}

type Json = Record<string, unknown>
type Path = (string | number)[]

/** An issue inside the parser. `cont` is zod's `continue`: a false one stops the checks that follow. */
interface Raw {
  code: string
  path: Path
  message: string
  cont: boolean
}

interface Run {
  value: unknown
  issues: Raw[]
}

type Check =
  | { kind: 'min' | 'max'; length: boolean; value: number; msg?: string }
  | { kind: 'int'; msg?: string }
  | { kind: 'positive'; msg?: string }
  | { kind: 'trim' }
  | { kind: 'regex'; re: RegExp; msg?: string }
  | { kind: 'refine'; fn: (value: unknown) => unknown; msg?: string }
  | { kind: 'superRefine'; fn: (value: unknown, ctx: RefineContext) => void }

const MAX_SAFE = Number.MAX_SAFE_INTEGER

function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('; ')
}

function publicIssues(raws: Raw[]): Issue[] {
  return raws.map((r) => ({ code: r.code, path: [...r.path], message: r.message }))
}

function issue(code: string, message: string, cont = false): Raw {
  return { code, path: [], message, cont }
}

/** What zod calls the received type in "expected X, received Y". */
function received(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : Number.isFinite(value) ? 'number' : String(value)
  return typeof value
}

function invalidType(expected: string, value: unknown): Raw {
  return issue('invalid_type', `Invalid input: expected ${expected}, received ${received(value)}`)
}

function stringifyPrimitive(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : `${value}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Length as zod counts it: code points for strings, items for arrays. */
function lengthOf(value: unknown): number {
  return typeof value === 'string' ? [...value].length : (value as { length: number }).length
}

function hasLength(value: unknown): boolean {
  return value !== null && value !== undefined && (value as { length?: unknown }).length !== undefined
}

function originOf(value: unknown): 'array' | 'string' | 'unknown' {
  return Array.isArray(value) ? 'array' : typeof value === 'string' ? 'string' : 'unknown'
}

/** Sets an own property, so a key named "__proto__" is data and not the prototype. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** A value as JSON would store it (a JSON Schema "default" must be plain JSON). */
function jsonCopy(value: unknown): unknown {
  const text = JSON.stringify(value)
  return text === undefined ? undefined : (JSON.parse(text) as unknown)
}

function prefixed(issues: Raw[], key: string | number): Raw[] {
  return issues.map((i) => ({ ...i, path: [key, ...i.path] }))
}

/** Runs the checks in order. Length checks run after a type failure too, as zod's do (they
 *  only need a length). Every other check stops at the first aborting issue. */
function runChecks(checks: readonly Check[], start: unknown, issues: Raw[]): unknown {
  let value = start
  let aborted = issues.some((i) => !i.cont)
  for (const check of checks) {
    const lengthCheck = (check.kind === 'min' || check.kind === 'max') && check.length
    if (lengthCheck ? !hasLength(value) : aborted) continue
    switch (check.kind) {
      case 'trim':
        if (typeof value === 'string') value = value.trim()
        break
      case 'min':
      case 'max': {
        const size = check.length ? lengthOf(value) : (value as number)
        const ok = check.kind === 'min' ? size >= check.value : size <= check.value
        if (ok) break
        const origin = check.length ? originOf(value) : 'number'
        const sizing = origin === 'string' ? 'characters' : origin === 'array' ? 'items' : null
        const bound = `${check.kind === 'min' ? '>=' : '<='}${check.value}`
        const text = check.kind === 'min' ? 'Too small' : 'Too big'
        const message =
          check.msg ?? `${text}: expected ${origin} to ${sizing ? `have ${bound} ${sizing}` : `be ${bound}`}`
        issues.push(issue(check.kind === 'min' ? 'too_small' : 'too_big', message, true))
        break
      }
      case 'int':
        // A non-integer aborts the checks after it; an integer outside the safe range is a bound.
        if (!Number.isInteger(value)) {
          issues.push(issue('invalid_type', check.msg ?? `Invalid input: expected int, received ${received(value)}`))
        } else if ((value as number) > MAX_SAFE) {
          issues.push(issue('too_big', `Too big: expected int to be <=${MAX_SAFE}`, true))
        } else if ((value as number) < -MAX_SAFE) {
          issues.push(issue('too_small', `Too small: expected int to be >=${-MAX_SAFE}`, true))
        }
        break
      case 'positive':
        if (!((value as number) > 0)) {
          issues.push(issue('too_small', check.msg ?? 'Too small: expected number to be >0', true))
        }
        break
      case 'regex':
        check.re.lastIndex = 0
        if (!check.re.test(value as string)) {
          issues.push(issue('invalid_format', check.msg ?? `Invalid string: must match pattern ${check.re}`, true))
        }
        break
      case 'refine':
        if (!check.fn(value)) issues.push(issue('custom', check.msg ?? 'Invalid input', true))
        break
      case 'superRefine': {
        const ctx: RefineContext = {
          addIssue(added) {
            issues.push({
              code: added.code ?? 'custom',
              path: [...(added.path ?? [])],
              message: added.message ?? 'Invalid input',
              cont: true,
            })
          },
        }
        check.fn(value, ctx)
        break
      }
    }
    aborted = issues.some((i) => !i.cont)
  }
  return value
}

/** zod's JSON Schema joins options that are all bare types into one "type" list. */
function anyOf(options: Json[]): Json {
  const types: string[] = []
  for (const option of options) {
    const keys = Object.keys(option)
    if (keys.length !== 1 || keys[0] !== 'type') return { anyOf: options }
    const members = Array.isArray(option.type) ? option.type : [option.type]
    for (const member of members) {
      if (typeof member !== 'string') return { anyOf: options }
      if (!types.includes(member)) types.push(member)
    }
  }
  return { type: types.length === 1 ? types[0] : types }
}

/** The JSON Schema of a schema, with its description. */
function schemaJson(schema: Schema<unknown, unknown>): Json {
  const json = schema._jsonSchema()
  return schema.meta.description === undefined ? json : { ...json, description: schema.meta.description }
}

interface Meta {
  description?: string
}

/**
 * The base of every schema. Each method returns a new schema, so a schema can be shared and
 * extended without changing the original.
 */
export abstract class Schema<O = unknown, I = O> {
  /** Types only (read by Infer). Not set at runtime. */
  declare readonly _output: O
  /** Types only (read by InferInput). Not set at runtime. */
  declare readonly _input: I

  protected checks: readonly Check[] = []
  /** @internal The description from describe(). */
  meta: Meta = {}

  /** Runs this schema's own type check and its wrapped schemas, without the checks of this one. */
  protected abstract core(input: unknown): Run
  /** The JSON Schema of this schema, without its description. */
  abstract _jsonSchema(): Json
  /** Whether an absent object key is allowed (zod's "optional in"). */
  _optionalIn(): boolean {
    return false
  }

  /** @internal Runs the schema: the type check, then the checks in order. */
  _run(input: unknown): Run {
    const first = this.core(input)
    if (this.checks.length === 0) return first
    const issues = first.issues.slice()
    const value = runChecks(this.checks, first.value, issues)
    return { value, issues }
  }

  /** Standard Schema v1, so TanStack Start and other tools can validate with this schema. */
  get '~standard'(): StandardSchemaProps<I, O> {
    return {
      version: 1,
      vendor: 'powdock',
      validate: (value: unknown) => {
        const run = this._run(value)
        if (run.issues.length === 0) return { value: run.value as O }
        return { issues: publicIssues(run.issues) }
      },
    }
  }

  /** Returns the parsed value, or throws a SchemaError. */
  parse(input: unknown): O {
    const run = this._run(input)
    if (run.issues.length) throw new SchemaError(publicIssues(run.issues))
    return run.value as O
  }

  /** Returns the parsed value, or the error with its issues. */
  safeParse(input: unknown): SafeParseResult<O> {
    const run = this._run(input)
    if (run.issues.length) return { success: false, error: new SchemaError(publicIssues(run.issues)) }
    return { success: true, data: run.value as O }
  }

  describe(text: string): this {
    return this.copy({ meta: { ...this.meta, description: text } })
  }

  optional(): OptionalSchema<O, I> {
    return new OptionalSchema(this)
  }

  nullable(): NullableSchema<O, I> {
    return new NullableSchema(this)
  }

  /** The value used when the input is undefined. The default is not validated. */
  default(value: Exclude<O, undefined>): DefaultSchema<O, I> {
    return new DefaultSchema(this, value)
  }

  /** The value used when this schema fails, whatever the failure. */
  catch(value: O): CatchSchema<O, I> {
    return new CatchSchema(this, value)
  }

  refine(fn: (value: O) => unknown, message?: string): this {
    return this.addCheck({ kind: 'refine', fn: fn as (value: unknown) => unknown, msg: message })
  }

  superRefine(fn: (value: O, ctx: RefineContext) => void): this {
    return this.addCheck({ kind: 'superRefine', fn: fn as (value: unknown, ctx: RefineContext) => void })
  }

  protected addCheck(check: Check): this {
    return this.copy({ checks: [...this.checks, check] })
  }

  /** A copy of this schema with some of its own fields replaced. */
  protected copy(patch: Record<string, unknown>): this {
    const next = Object.create(Object.getPrototypeOf(this)) as this
    Object.assign(next, this, patch)
    return next
  }
}

/** The JSON Schema for a schema (draft 2020-12). */
export function toJSONSchema(schema: Schema<unknown, unknown>): Json {
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schemaJson(schema) }
}

class StringSchema extends Schema<string, string> {
  protected core(input: unknown): Run {
    if (typeof input !== 'string') return { value: input, issues: [invalidType('string', input)] }
    return { value: input, issues: [] }
  }

  min(length: number, message?: string): this {
    return this.addCheck({ kind: 'min', length: true, value: length, msg: message })
  }

  max(length: number, message?: string): this {
    return this.addCheck({ kind: 'max', length: true, value: length, msg: message })
  }

  trim(): this {
    return this.addCheck({ kind: 'trim' })
  }

  regex(pattern: RegExp, message?: string): this {
    return this.addCheck({ kind: 'regex', re: pattern, msg: message })
  }

  _jsonSchema(): Json {
    const json: Json = { type: 'string' }
    let minLength: number | undefined
    let maxLength: number | undefined
    const patterns: string[] = []
    for (const check of this.checks) {
      if (check.kind === 'min' && check.length) minLength = Math.max(minLength ?? check.value, check.value)
      if (check.kind === 'max' && check.length) maxLength = Math.min(maxLength ?? check.value, check.value)
      if (check.kind === 'regex') patterns.push(check.re.source)
    }
    if (minLength !== undefined) json.minLength = minLength
    if (maxLength !== undefined) json.maxLength = maxLength
    if (patterns.length === 1) json.pattern = patterns[0]
    else if (patterns.length > 1) json.allOf = patterns.map((pattern) => ({ pattern }))
    return json
  }
}

class NumberSchema extends Schema<number, number> {
  protected core(input: unknown): Run {
    if (typeof input !== 'number' || !Number.isFinite(input)) {
      return { value: input, issues: [invalidType('number', input)] }
    }
    return { value: input, issues: [] }
  }

  min(value: number, message?: string): this {
    return this.addCheck({ kind: 'min', length: false, value, msg: message })
  }

  max(value: number, message?: string): this {
    return this.addCheck({ kind: 'max', length: false, value, msg: message })
  }

  int(message?: string): this {
    return this.addCheck({ kind: 'int', msg: message })
  }

  positive(message?: string): this {
    return this.addCheck({ kind: 'positive', msg: message })
  }

  _jsonSchema(): Json {
    let isInt = false
    let minimum: number | undefined
    let maximum: number | undefined
    let exclusiveMinimum: number | undefined
    const narrowMin = (current: number | undefined, value: number) =>
      current === undefined || value > current ? value : current
    const narrowMax = (current: number | undefined, value: number) =>
      current === undefined || value < current ? value : current
    for (const check of this.checks) {
      if (check.kind === 'int') {
        isInt = true
        minimum = narrowMin(minimum, -MAX_SAFE)
        maximum = narrowMax(maximum, MAX_SAFE)
      } else if (check.kind === 'min') {
        minimum = narrowMin(minimum, check.value)
      } else if (check.kind === 'max') {
        maximum = narrowMax(maximum, check.value)
      } else if (check.kind === 'positive') {
        exclusiveMinimum = narrowMin(exclusiveMinimum, 0)
      }
    }
    const json: Json = { type: isInt ? 'integer' : 'number' }
    if (exclusiveMinimum !== undefined && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY)) {
      json.exclusiveMinimum = exclusiveMinimum
    } else if (minimum !== undefined) {
      json.minimum = minimum
    }
    if (maximum !== undefined) json.maximum = maximum
    return json
  }
}

class BooleanSchema extends Schema<boolean, boolean> {
  protected core(input: unknown): Run {
    if (typeof input !== 'boolean') return { value: input, issues: [invalidType('boolean', input)] }
    return { value: input, issues: [] }
  }

  _jsonSchema(): Json {
    return { type: 'boolean' }
  }
}

class NullSchema extends Schema<null, null> {
  protected core(input: unknown): Run {
    if (input !== null) return { value: input, issues: [invalidType('null', input)] }
    return { value: input, issues: [] }
  }

  _jsonSchema(): Json {
    return { type: 'null' }
  }
}

class UnknownSchema extends Schema<unknown, unknown> {
  protected core(input: unknown): Run {
    return { value: input, issues: [] }
  }

  _jsonSchema(): Json {
    return {}
  }
}

class LiteralSchema<T extends string | number | boolean> extends Schema<T, T> {
  constructor(readonly literal: T) {
    super()
  }

  protected core(input: unknown): Run {
    if (input !== this.literal) {
      return {
        value: input,
        issues: [issue('invalid_value', `Invalid input: expected ${stringifyPrimitive(this.literal)}`)],
      }
    }
    return { value: input, issues: [] }
  }

  _jsonSchema(): Json {
    return { type: typeof this.literal, const: this.literal }
  }
}

class EnumSchema<T extends string> extends Schema<T, T> {
  constructor(readonly values: readonly T[]) {
    super()
  }

  protected core(input: unknown): Run {
    if (!(this.values as readonly unknown[]).includes(input)) {
      const message =
        this.values.length === 1
          ? `Invalid input: expected ${stringifyPrimitive(this.values[0])}`
          : `Invalid option: expected one of ${this.values.map(stringifyPrimitive).join('|')}`
      return { value: input, issues: [issue('invalid_value', message)] }
    }
    return { value: input, issues: [] }
  }

  _jsonSchema(): Json {
    return { type: 'string', enum: [...this.values] }
  }
}

class ArraySchema<E extends Schema<unknown, unknown>> extends Schema<Infer<E>[], InferInput<E>[]> {
  constructor(readonly element: E) {
    super()
  }

  protected core(input: unknown): Run {
    if (!Array.isArray(input)) return { value: input, issues: [invalidType('array', input)] }
    const out: unknown[] = Array.from({ length: input.length })
    const issues: Raw[] = []
    input.forEach((item, index) => {
      const run = this.element._run(item)
      out[index] = run.value
      issues.push(...prefixed(run.issues, index))
    })
    return { value: out, issues }
  }

  min(length: number, message?: string): this {
    return this.addCheck({ kind: 'min', length: true, value: length, msg: message })
  }

  max(length: number, message?: string): this {
    return this.addCheck({ kind: 'max', length: true, value: length, msg: message })
  }

  _jsonSchema(): Json {
    const json: Json = { type: 'array', items: schemaJson(this.element) }
    for (const check of this.checks) {
      if (check.kind === 'min' && check.length) json.minItems = check.value
      if (check.kind === 'max' && check.length) json.maxItems = check.value
    }
    return json
  }
}

export type Shape = Record<string, Schema<unknown, unknown>>

type Simplify<T> = { [K in keyof T]: T[K] } & {}

type ObjectOutput<S extends Shape> = Simplify<
  { [K in keyof S as undefined extends Infer<S[K]> ? never : K]: Infer<S[K]> } & {
    [K in keyof S as undefined extends Infer<S[K]> ? K : never]?: Infer<S[K]>
  }
>

type ObjectInput<S extends Shape> = Simplify<
  { [K in keyof S as undefined extends InferInput<S[K]> ? never : K]: InferInput<S[K]> } & {
    [K in keyof S as undefined extends InferInput<S[K]> ? K : never]?: InferInput<S[K]>
  }
>

class ObjectSchema<S extends Shape> extends Schema<ObjectOutput<S>, ObjectInput<S>> {
  constructor(
    readonly shape: S,
    readonly strict: boolean,
  ) {
    super()
  }

  protected core(input: unknown): Run {
    if (!isRecord(input)) return { value: input, issues: [invalidType('object', input)] }
    const out: Record<string, unknown> = {}
    const issues: Raw[] = []
    for (const key of Object.keys(this.shape)) {
      const present = key in input
      const run = this.shape[key]!._run(input[key])
      issues.push(...prefixed(run.issues, key))
      if (run.value !== undefined || present) setOwn(out, key, run.value)
    }
    if (this.strict) {
      const unknownKeys = Object.keys(input).filter((key) => !Object.hasOwn(this.shape, key))
      if (unknownKeys.length) {
        const list = unknownKeys.map((k) => `"${k}"`).join(', ')
        issues.push(issue('unrecognized_keys', `Unrecognized key${unknownKeys.length > 1 ? 's' : ''}: ${list}`, true))
      }
    }
    return { value: out, issues }
  }

  /** Adds or replaces fields. The checks of this schema are not carried over. */
  extend<T extends Shape>(more: T): ObjectSchema<S & T> {
    return new ObjectSchema({ ...this.shape, ...more }, this.strict)
  }

  /** Keeps only the named fields. The checks of this schema are not carried over. */
  pick<K extends keyof S & string>(mask: { [P in K]: true }): ObjectSchema<Pick<S, K>> {
    const shape = {} as Pick<S, K>
    for (const key of Object.keys(mask) as K[]) shape[key] = this.shape[key]
    return new ObjectSchema(shape, this.strict)
  }

  _jsonSchema(): Json {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const key of Object.keys(this.shape)) {
      const field = this.shape[key]!
      setOwn(properties, key, schemaJson(field))
      if (!field._optionalIn()) required.push(key)
    }
    const json: Json = { type: 'object', properties }
    if (required.length) json.required = required
    if (this.strict) json.additionalProperties = false
    return json
  }
}

class RecordSchema<V extends Schema<unknown, unknown>> extends Schema<
  Record<string, Infer<V>>,
  Record<string, InferInput<V>>
> {
  constructor(readonly value: V) {
    super()
  }

  protected core(input: unknown): Run {
    if (!isRecord(input)) return { value: input, issues: [invalidType('record', input)] }
    const out: Record<string, unknown> = {}
    const issues: Raw[] = []
    for (const key of Object.keys(input)) {
      const run = this.value._run(input[key])
      issues.push(...prefixed(run.issues, key))
      setOwn(out, key, run.value)
    }
    return { value: out, issues }
  }

  _jsonSchema(): Json {
    return { type: 'object', propertyNames: { type: 'string' }, additionalProperties: schemaJson(this.value) }
  }
}

class UnionSchema<T extends readonly Schema<unknown, unknown>[]> extends Schema<
  Infer<T[number]>,
  InferInput<T[number]>
> {
  constructor(readonly options: T) {
    super()
  }

  protected core(input: unknown): Run {
    const failed: Run[] = []
    for (const option of this.options) {
      const run = option._run(input)
      if (run.issues.length === 0) return run
      failed.push(run)
    }
    // When exactly one option got past its type check, its own issues are the answer.
    const past = failed.filter((run) => run.issues.every((i) => i.cont))
    if (past.length === 1) return past[0]!
    return { value: input, issues: [issue('invalid_union', 'Invalid input')] }
  }

  _jsonSchema(): Json {
    return anyOf(this.options.map(schemaJson))
  }
}

class OptionalSchema<O, I> extends Schema<O | undefined, I | undefined> {
  constructor(readonly inner: Schema<O, I>) {
    super()
  }

  protected core(input: unknown): Run {
    if (input === undefined) return { value: undefined, issues: [] }
    return this.inner._run(input)
  }

  _optionalIn(): boolean {
    return true
  }

  _jsonSchema(): Json {
    return schemaJson(this.inner as Schema<unknown, unknown>)
  }
}

class NullableSchema<O, I> extends Schema<O | null, I | null> {
  constructor(readonly inner: Schema<O, I>) {
    super()
  }

  protected core(input: unknown): Run {
    if (input === null) return { value: null, issues: [] }
    return this.inner._run(input)
  }

  _optionalIn(): boolean {
    return this.inner._optionalIn()
  }

  _jsonSchema(): Json {
    return anyOf([schemaJson(this.inner as Schema<unknown, unknown>), { type: 'null' }])
  }
}

class DefaultSchema<O, I> extends Schema<Exclude<O, undefined>, I | undefined> {
  constructor(
    readonly inner: Schema<O, I>,
    readonly fallback: unknown,
  ) {
    super()
  }

  protected core(input: unknown): Run {
    if (input === undefined) {
      const value =
        typeof this.fallback === 'object' && this.fallback !== null ? structuredClone(this.fallback) : this.fallback
      return { value, issues: [] }
    }
    return this.inner._run(input)
  }

  _optionalIn(): boolean {
    return true
  }

  _jsonSchema(): Json {
    return { ...schemaJson(this.inner as Schema<unknown, unknown>), default: jsonCopy(this.fallback) }
  }
}

class CatchSchema<O, I> extends Schema<O, I> {
  constructor(
    readonly inner: Schema<O, I>,
    readonly fallback: O,
  ) {
    super()
  }

  protected core(input: unknown): Run {
    const run = this.inner._run(input)
    if (run.issues.length === 0) return run
    return { value: this.fallback, issues: [] }
  }

  _optionalIn(): boolean {
    return this.inner._optionalIn()
  }

  _jsonSchema(): Json {
    const json = schemaJson(this.inner as Schema<unknown, unknown>)
    return this.fallback === undefined ? json : { ...json, default: jsonCopy(this.fallback) }
  }
}

/** The schema builder. The names match zod's, so `s.object(...)` reads like `z.object(...)`. */
export const s = {
  string: (): StringSchema => new StringSchema(),
  number: (): NumberSchema => new NumberSchema(),
  boolean: (): BooleanSchema => new BooleanSchema(),
  null: (): NullSchema => new NullSchema(),
  unknown: (): UnknownSchema => new UnknownSchema(),
  literal: <const T extends string | number | boolean>(value: T): LiteralSchema<T> => new LiteralSchema(value),
  enum: <const T extends string>(values: readonly [T, ...T[]]): EnumSchema<T> => new EnumSchema(values),
  array: <E extends Schema<unknown, unknown>>(element: E): ArraySchema<E> => new ArraySchema(element),
  object: <S extends Shape>(shape: S): ObjectSchema<S> => new ObjectSchema(shape, false),
  strictObject: <S extends Shape>(shape: S): ObjectSchema<S> => new ObjectSchema(shape, true),
  record: <V extends Schema<unknown, unknown>>(_key: StringSchema, value: V): RecordSchema<V> =>
    new RecordSchema(value),
  union: <const T extends readonly [Schema<unknown, unknown>, ...Schema<unknown, unknown>[]]>(
    options: T,
  ): UnionSchema<T> => new UnionSchema(options),
}
