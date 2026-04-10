import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { findProjectRoot } from "../src/core/project-root.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("findProjectRoot", () => {
  it("returns nearest git root directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-root-"));
    cleanupDirs.push(base);

    const repoRoot = join(base, "workspace");
    await mkdir(join(repoRoot, ".git"), { recursive: true });

    const nested = join(repoRoot, "packages", "tooling", "app");
    await mkdir(nested, { recursive: true });

    await writeFile(join(nested, "README.md"), "test");

    const root = await findProjectRoot(nested);
    expect(root).toBe(repoRoot);
  });

  it("falls back to cwd if no git root exists", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-project-root-fallback-"));
    cleanupDirs.push(base);

    const cwd = join(base, "plain-dir", "nested");
    await mkdir(cwd, { recursive: true });

    const root = await findProjectRoot(cwd);
    expect(root).toBe(cwd);
  });
});
