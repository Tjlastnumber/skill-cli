import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { groupScannedSkillsIntoBundles } from "../src/core/discovery/group-scanned-bundles.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("groupScannedSkillsIntoBundles", () => {
  it("groups multiple managed store entries from one source into one bundle", async () => {
    const base = await mkdtemp(join(tmpdir(), "skill-cli-grouping-"));
    cleanupDirs.push(base);

    const targetRoot = join(base, "target", "codex-global");
    const sourceRoot = join(base, "sources", "skills-source");
    const storeRoot = join(base, "store", "store");
    const sourceCanonical = sourceRoot;
    const sourceCacheKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    const alphaStoreDir = join(storeRoot, "1111111111111111111111111111111111111111111111111111111111111111");
    const betaStoreDir = join(storeRoot, "2222222222222222222222222222222222222222222222222222222222222222");

    await mkdir(targetRoot, { recursive: true });
    await mkdir(join(sourceRoot, "alpha-skill"), { recursive: true });
    await mkdir(join(sourceRoot, "beta-skill"), { recursive: true });
    await mkdir(alphaStoreDir, { recursive: true });
    await mkdir(betaStoreDir, { recursive: true });

    await writeFile(join(alphaStoreDir, "SKILL.md"), "# alpha\n");
    await writeFile(join(betaStoreDir, "SKILL.md"), "# beta\n");
    await writeFile(
      join(alphaStoreDir, ".skill-cli-source.json"),
      `${JSON.stringify(
        {
          version: 2,
          storeEntryKind: "skill",
          bundleName: "skills-source",
          skillName: "alpha-skill",
          description: "",
          relativeSkillDir: "alpha-skill",
          sourceKind: "local",
          sourceRaw: sourceRoot,
          sourceCanonical,
          sourceRevision: sourceCacheKey,
          sourceDisplayName: "skills-source",
          sourceManifestPath: join(base, "store", "manifests", "source.json"),
          sourceCacheKey,
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(betaStoreDir, ".skill-cli-source.json"),
      `${JSON.stringify(
        {
          version: 2,
          storeEntryKind: "skill",
          bundleName: "skills-source",
          skillName: "beta-skill",
          description: "",
          relativeSkillDir: "beta-skill",
          sourceKind: "local",
          sourceRaw: sourceRoot,
          sourceCanonical,
          sourceRevision: sourceCacheKey,
          sourceDisplayName: "skills-source",
          sourceManifestPath: join(base, "store", "manifests", "source.json"),
          sourceCacheKey,
        },
        null,
        2,
      )}\n`,
    );

    await symlink(alphaStoreDir, join(targetRoot, "alpha-skill"), "dir");
    await symlink(betaStoreDir, join(targetRoot, "beta-skill"), "dir");

    const bundles = await groupScannedSkillsIntoBundles([
      {
        tool: "codex",
        skillName: "alpha-skill",
        targetType: "global",
        targetRoot,
        linkPath: join(targetRoot, "alpha-skill"),
        isSymlink: true,
        isBrokenSymlink: false,
        sourceSkillDir: alphaStoreDir,
      },
      {
        tool: "codex",
        skillName: "beta-skill",
        targetType: "global",
        targetRoot,
        linkPath: join(targetRoot, "beta-skill"),
        isSymlink: true,
        isBrokenSymlink: false,
        sourceSkillDir: betaStoreDir,
      },
    ]);

    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({
      bundleName: "skills-source",
      sourceKind: "local",
      sourceCanonical,
    });
    expect(bundles[0]?.members.map((member) => member.skillName)).toEqual([
      "alpha-skill",
      "beta-skill",
    ]);
  });
});
