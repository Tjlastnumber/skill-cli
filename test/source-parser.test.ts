import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createSourceCacheKey } from "../src/core/source/cache-key.js";
import { parseSource } from "../src/core/source/parse.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("parseSource", () => {
  it("detects local source from existing relative path", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-source-local-"));
    cleanupDirs.push(base);

    const cwd = join(base, "workspace");
    const localDir = join(cwd, "skills", "my-skill");

    await mkdir(localDir, { recursive: true });

    const parsed = await parseSource("skills/my-skill", { cwd });

    expect(parsed.kind).toBe("local");
    if (parsed.kind === "local") {
      expect(parsed.path).toBe(resolve(cwd, "skills/my-skill"));
    }
  });

  it("detects git source from full URL", async () => {
    const parsed = await parseSource("https://github.com/acme/skills.git#main", {
      cwd: process.cwd(),
    });

    expect(parsed.kind).toBe("git");
    if (parsed.kind === "git") {
      expect(parsed.url).toBe("https://github.com/acme/skills.git");
      expect(parsed.ref).toBe("main");
    }
  });

  it("detects git source from owner/repo shorthand", async () => {
    const parsed = await parseSource("acme/skills", { cwd: process.cwd() });

    expect(parsed.kind).toBe("git");
    if (parsed.kind === "git") {
      expect(parsed.url).toBe("https://github.com/acme/skills.git");
      expect(parsed.ref).toBeUndefined();
    }
  });

  it("detects npm source from package spec", async () => {
    const parsed = await parseSource("@acme/skills-kit@1.2.3", {
      cwd: process.cwd(),
    });

    expect(parsed.kind).toBe("npm");
    if (parsed.kind === "npm") {
      expect(parsed.spec).toBe("@acme/skills-kit@1.2.3");
      expect(parsed.packageName).toBe("@acme/skills-kit");
      expect(parsed.version).toBe("1.2.3");
    }
  });
});

describe("createSourceCacheKey", () => {
  it("returns stable key for same descriptor", () => {
    const key1 = createSourceCacheKey({
      kind: "git",
      raw: "acme/skills#main",
      url: "https://github.com/acme/skills.git",
      ref: "main",
    });
    const key2 = createSourceCacheKey({
      kind: "git",
      raw: "acme/skills#main",
      url: "https://github.com/acme/skills.git",
      ref: "main",
    });

    expect(key1).toBe(key2);
  });

  it("returns different keys for different refs", () => {
    const mainKey = createSourceCacheKey({
      kind: "git",
      raw: "acme/skills#main",
      url: "https://github.com/acme/skills.git",
      ref: "main",
    });

    const tagKey = createSourceCacheKey({
      kind: "git",
      raw: "acme/skills#v1.0.0",
      url: "https://github.com/acme/skills.git",
      ref: "v1.0.0",
    });

    expect(mainKey).not.toBe(tagKey);
  });
});
