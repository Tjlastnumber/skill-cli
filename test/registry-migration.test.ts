import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadRegistry } from "../src/core/registry/registry.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("registry migration", () => {
  it("migrates v1 skill entries into one bundle grouped by cache key", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-registry-migrate-"));
    cleanupDirs.push(base);

    const storeRoot = join(base, "store-root");
    const cacheKey = "abc123";
    const storedSourceDir = join(storeRoot, "store", cacheKey);

    await mkdir(join(storedSourceDir, ".git"), { recursive: true });
    await writeFile(
      join(storedSourceDir, ".git", "config"),
      "[remote \"origin\"]\n  url = git@github.com:obra/superpowers.git\n",
    );

    const legacyRegistry = {
      version: 1,
      installs: [
        {
          skillName: "using-superpowers",
          tool: "opencode",
          targetType: "project",
          targetRoot: "/tmp/project/.opencode/skills",
          linkPath: "/tmp/project/.opencode/skills/using-superpowers",
          sourceRaw: `${storedSourceDir}/skills/using-superpowers`,
          sourceKind: "unknown",
          cacheKey,
          storedSourceDir,
          installedAt: "2026-04-09T00:00:00.000Z",
          updatedAt: "2026-04-09T00:00:00.000Z",
        },
        {
          skillName: "writing-skills",
          tool: "opencode",
          targetType: "project",
          targetRoot: "/tmp/project/.opencode/skills",
          linkPath: "/tmp/project/.opencode/skills/writing-skills",
          sourceRaw: `${storedSourceDir}/skills/writing-skills`,
          sourceKind: "unknown",
          cacheKey,
          storedSourceDir,
          installedAt: "2026-04-09T00:00:00.000Z",
          updatedAt: "2026-04-09T00:00:00.000Z",
        },
      ],
    };

    await mkdir(storeRoot, { recursive: true });
    await writeFile(join(storeRoot, "registry.json"), `${JSON.stringify(legacyRegistry, null, 2)}\n`);

    const migrated = await loadRegistry(storeRoot);

    expect(migrated.version).toBe(2);
    expect(migrated.bundles).toHaveLength(1);
    expect(migrated.bundles[0]).toMatchObject({
      bundleName: "superpowers",
      sourceKind: "git",
      tool: "opencode",
    });
    expect(migrated.bundles[0]?.members).toHaveLength(2);

    const persistedRaw = await readFile(join(storeRoot, "registry.json"), "utf8");
    expect(persistedRaw).toContain('"version": 2');
  });
});
