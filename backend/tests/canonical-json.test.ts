import { describe, expect, it } from "vitest";
import {
  canonicalizeJson,
  sha256CanonicalJson,
} from "../src/services/canonical-json.js";

describe("canonical JSON", () => {
  it("object keyを再帰的にsortする", () => {
    expect(
      canonicalizeJson({ z: 1, a: { c: true, b: [2, "x"] } }),
    ).toBe('{"a":{"b":[2,"x"],"c":true},"z":1}');
  });

  it("同じ意味のobjectから同じSHA-256を生成する", () => {
    const first = sha256CanonicalJson({ b: 2, a: 1 });
    const second = sha256CanonicalJson({ a: 1, b: 2 });
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
