import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { resolveProjectSkillsLockfilePath } from "../src/core/lockfile/path.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("resolveProjectSkillsLockfilePath", () => {
  it("resolves to skills-lock.yaml at the project root", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-path-"));
    cleanupDirs.push(base);

    const repoRoot = join(base, "workspace");
    const cwd = join(repoRoot, "packages", "app");

    await mkdir(join(repoRoot, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });

    await expect(resolveProjectSkillsLockfilePath(cwd)).resolves.toBe(
      join(repoRoot, "skills-lock.yaml"),
    );
  });

  it("falls back to the provided cwd when no project root marker exists", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-lockfile-path-fallback-"));
    cleanupDirs.push(base);

    const cwd = join(base, "plain", "nested");
    await mkdir(cwd, { recursive: true });

    await expect(resolveProjectSkillsLockfilePath(cwd)).resolves.toBe(join(cwd, "skills-lock.yaml"));
  });
});
