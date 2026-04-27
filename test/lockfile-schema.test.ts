import { describe, expect, it } from "vitest";

import { skillsLockfileSchema } from "../src/core/lockfile/schema.js";

describe("skillsLockfileSchema", () => {
  it("accepts version 1 with non-empty bundle sources", () => {
    const parsed = skillsLockfileSchema.parse({
      version: 1,
      bundles: [{ source: "npm:@scope/skills@1.2.3" }, { source: "./skills/local-bundle" }],
    });

    expect(parsed).toEqual({
      version: 1,
      bundles: [{ source: "npm:@scope/skills@1.2.3" }, { source: "./skills/local-bundle" }],
    });
  });

  it("rejects invalid lockfile shape", () => {
    const parsed = skillsLockfileSchema.safeParse({
      version: 2,
      bundles: [{ source: "" }],
      extra: true,
    });

    expect(parsed.success).toBe(false);
  });
});
