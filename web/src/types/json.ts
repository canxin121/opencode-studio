export type JsonPrimitive = string | number | boolean | null

// Keep frontend JSON handling permissive for now; many settings views still
// rely on dynamically-shaped values that are narrowed at runtime.
export type JsonValue = ReturnType<typeof JSON.parse>

export type JsonObject = Record<string, JsonValue>

export type StrictJsonPrimitive = string | number | boolean | null

export interface StrictJsonObject {
  [key: string]: StrictJsonValue
}

export type StrictJsonValue = StrictJsonPrimitive | StrictJsonObject | StrictJsonValue[] | undefined
