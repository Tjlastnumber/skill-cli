import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readSourceMetadata, writeSourceMetadata } from "../src/core/store/source-metadata.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("source metadata v2", () => {
  it("round-trips optional sourceCommitSha and sourceRepoKey for git provenance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skill-cli-meta-v2-"));
    cleanupDirs.push(dir);

    await writeSourceMetadata(dir, {
      version: 2,
      storeEntryKind: "skill",
      bundleName: "skills",
      skillName: "alpha",
      description: "",
      relativeSkillDir: "alpha",
      sourceKind: "git",
      sourceRaw: "git@github.com:acme/skills.git",
      sourceCanonical: "github.com/acme/skills",
      sourceRevision: "cachekey",
      sourceDisplayName: "skills",
      sourceManifestPath: join(dir, "manifest.json"),
      sourceCacheKey: "cachekey",
      sourceCommitSha: "0123456789abcdef0123456789abcdef01234567",
      sourceRepoKey: "a".repeat(64),
    });

    const read = await readSourceMetadata(dir);
    expect(read).toMatchObject({
      version: 2,
      sourceCommitSha: "0123456789abcdef0123456789abcdef01234567",
      sourceRepoKey: "a".repeat(64),
    });
  });

  it("still parses v2 metadata written without the new optional fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "skill-cli-meta-v2-legacy-"));
    cleanupDirs.push(dir);

    await writeFile(
      join(dir, ".skill-cli-source.json"),
      `${JSON.stringify({
        version: 2,
        storeEntryKind: "skill",
        bundleName: "skills",
        skillName: "alpha",
        description: "",
        relativeSkillDir: "alpha",
        sourceKind: "git",
        sourceRaw: "git@github.com:acme/skills.git",
        sourceCanonical: "github.com/acme/skills",
        sourceRevision: "cachekey",
        sourceDisplayName: "skills",
        sourceManifestPath: join(dir, "manifest.json"),
        sourceCacheKey: "cachekey",
      })}\n`,
    );

    const read = await readSourceMetadata(dir);
    expect(read).toMatchObject({ version: 2, skillName: "alpha" });
    expect(read).not.toHaveProperty("sourceCommitSha");
  });
});
