/**
 * Vendored Standard Schema v1 (https://standardschema.dev) — types only, no runtime, no dep.
 * Zod 4, Valibot, and ArkType all implement it, so conveyor validates against any of them.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>
}

export namespace StandardSchemaV1 {
  export interface Props<Input, Output> {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>
    readonly types?: Types<Input, Output>
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult

  export interface SuccessResult<Output> {
    readonly value: Output
    readonly issues?: undefined
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>
  }

  export interface Issue {
    readonly message: string
    readonly path?: ReadonlyArray<PropertyKey | PathSegment>
  }

  export interface PathSegment {
    readonly key: PropertyKey
  }

  export interface Types<Input, Output> {
    readonly input: Input
    readonly output: Output
  }

  export type InferOutput<T extends StandardSchemaV1> = NonNullable<T['~standard']['types']>['output']
  export type InferInput<T extends StandardSchemaV1> = NonNullable<T['~standard']['types']>['input']
}

/** Validate against any Standard Schema; normalizes sync/async to a Promise. */
export async function validateSchema<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown
): Promise<StandardSchemaV1.Result<T>> {
  return schema['~standard'].validate(value)
}
