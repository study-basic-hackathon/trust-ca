import { createHash } from "node:crypto";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JSONには有限の数値だけを指定できます。");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalizeJson(value: JsonValue): string {
  return canonicalize(value);
}

export function sha256CanonicalJson(value: JsonValue): {
  canonicalJson: string;
  sha256: string;
} {
  const canonicalJson = canonicalizeJson(value);
  return {
    canonicalJson,
    sha256: createHash("sha256").update(canonicalJson).digest("hex"),
  };
}
