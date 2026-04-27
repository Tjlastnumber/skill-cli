import { describe, expect, it } from "vitest";

import { skillsLockfileSchema } from "../src/core/lockfile/schema.js";

describe("skillsLockfileSchema", () => {
  it("accepts version 2 with skill entries", () => {
    const parsed = skillsLockfileSchema.parse({
      version: 2,
      skills: [
        { source: "npm:@scope/skills@1.2.3", name: "*" },
        { source: "./skills/local-bundle", name: "browser" },
      ],
    });

    expect(parsed).toEqual({
      version: 2,
      skills: [
        { source: "npm:@scope/skills@1.2.3", name: "*" },
        { source: "./skills/local-bundle", name: "browser" },
      ],
    });
  });

  it("rejects version 1 and invalid lockfile shape", () => {
    const parsed = skillsLockfileSchema.safeParse({
      version: 1,
      bundles: [{ source: "" }],
      extra: true,
    });

    expect(parsed.success).toBe(false);
  });
});
