import { describe, expect, it } from "vitest";

import { parseStoredSourceFromPath } from "../src/core/store/store-path.js";

describe("parseStoredSourceFromPath", () => {
  const cacheKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("uses the last /store/ segment to extract cache key", () => {
    const parsed = parseStoredSourceFromPath(
      `/tmp/sandbox/store/store/${cacheKey}/skills/using-superpowers`,
    );

    expect(parsed).toMatchObject({
      cacheKey,
      storedSourceDir: `/tmp/sandbox/store/store/${cacheKey}`,
    });
  });

  it("ignores unrelated /store/ segments that do not contain a real cache key", () => {
    expect(parseStoredSourceFromPath("/tmp/external/store/not-a-cache/alpha-skill")).toBeUndefined();
  });
});
